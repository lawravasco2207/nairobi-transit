use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    db::payments::confirm_payment,
    domain::payment::PaymentConfirmedEvent,
    services::africastalking::ATService,
    AppState,
};

// ── Daraja callback payload structures ──────────────────────────────

#[derive(Deserialize, Debug)]
pub struct DarajaCallback {
    #[serde(rename = "Body")]
    pub body: CallbackBody,
}

#[derive(Deserialize, Debug)]
pub struct CallbackBody {
    #[serde(rename = "stkCallback")]
    pub stk_callback: StkCallback,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct StkCallback {
    #[serde(rename = "MerchantRequestID")]
    pub merchant_request_id: String,
    #[serde(rename = "CheckoutRequestID")]
    pub checkout_request_id: String,
    #[serde(rename = "ResultCode")]
    pub result_code: i32, // 0 = success
    #[serde(rename = "ResultDesc")]
    pub result_desc: String,
    #[serde(rename = "CallbackMetadata")]
    pub callback_metadata: Option<CallbackMetadata>,
}

#[derive(Deserialize, Debug)]
pub struct CallbackMetadata {
    #[serde(rename = "Item")]
    pub item: Vec<MetadataItem>,
}

#[derive(Deserialize, Debug)]
pub struct MetadataItem {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Value")]
    pub value: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct CallbackAck {
    #[serde(rename = "ResultCode")]
    result_code: i32,
    #[serde(rename = "ResultDesc")]
    result_desc: String,
}

/// POST /api/daraja/callback
/// Safaricom calls this when the passenger completes (or cancels) the STK Push.
/// We update the payment record and push to the conductor's WebSocket.
pub async fn daraja_callback(
    State(state): State<AppState>,
    Json(payload): Json<DarajaCallback>,
) -> Json<CallbackAck> {
    let cb = &payload.body.stk_callback;

    // ── Handle failure / cancellation ───────────────────────────────
    if cb.result_code != 0 {
        tracing::warn!(
            checkout_id = %cb.checkout_request_id,
            result_code = cb.result_code,
            desc = %cb.result_desc,
            "Payment failed or cancelled"
        );

        let _ = sqlx::query(
            "UPDATE payments SET status = 'failed' WHERE checkout_request_id = $1",
        )
        .bind(&cb.checkout_request_id)
        .execute(&state.db)
        .await;

        return Json(CallbackAck {
            result_code: 0,
            result_desc: "Accepted".to_string(),
        });
    }

    // ── Extract M-Pesa receipt number from metadata ─────────────────
    let mpesa_ref = cb
        .callback_metadata
        .as_ref()
        .and_then(|m| m.item.iter().find(|i| i.name == "MpesaReceiptNumber"))
        .and_then(|i| i.value.as_ref())
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();

    // ── Confirm payment in DB ───────────────────────────────────────
    match confirm_payment(&state.db, &cb.checkout_request_id, &mpesa_ref).await {
        Ok(Some(payment)) => {
            tracing::info!(
                payment_id = %payment.id,
                mpesa_ref = %mpesa_ref,
                phone = %payment.passenger_phone,
                "Payment confirmed"
            );

            // Push to conductor WebSocket in real time
            let event = PaymentConfirmedEvent {
                event: "payment_confirmed".to_string(),
                passenger_phone: payment.passenger_phone.clone(),
                amount_kes: payment.amount / 100,
                mpesa_ref: mpesa_ref.clone(),
                channel: payment.channel.clone(),
                trip_id: payment.trip_id,
            };
            let _ = state
                .ws_tx
                .send(serde_json::to_string(&event).unwrap_or_default());

            // Send SMS receipt (especially important for feature phone users)
            let at = ATService::new(&state.config);
            let sms = format!(
                "TRANSIT: Ksh {} fare paid. Ref: {}. Safe travels!",
                payment.amount / 100,
                mpesa_ref
            );
            if let Err(e) = at.send_sms(&payment.passenger_phone, &sms).await {
                tracing::warn!("SMS send failed: {:?}", e);
            }
        }
        Ok(None) => {
            tracing::warn!(
                checkout_id = %cb.checkout_request_id,
                "Callback received for unknown checkout ID"
            );
        }
        Err(e) => {
            tracing::error!("Failed to confirm payment: {:?}", e);
        }
    }

    // Always ACK to Daraja — otherwise they retry repeatedly
    Json(CallbackAck {
        result_code: 0,
        result_desc: "Accepted".to_string(),
    })
}
