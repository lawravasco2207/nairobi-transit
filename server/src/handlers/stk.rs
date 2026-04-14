use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::{payments, trips},
    error::AppError,
    services::daraja::DarajaService,
    AppState,
};

#[derive(Deserialize)]
pub struct InitiatePaymentRequest {
    pub vehicle_short_id: String,
    pub passenger_phone: String, // "0712345678" or "+254712345678"
}

#[derive(Serialize)]
pub struct InitiatePaymentResponse {
    pub success: bool,
    pub message: String,
    pub payment_id: Uuid,
}

/// POST /api/pay/qr
/// Passenger scans QR → browser opens pay page → JS calls this with the phone number.
/// We fire an STK Push so the M-Pesa PIN prompt appears on the passenger's phone.
pub async fn initiate_stk_payment(
    State(state): State<AppState>,
    Json(req): Json<InitiatePaymentRequest>,
) -> Result<Json<InitiatePaymentResponse>, AppError> {
    let phone = normalize_phone(&req.passenger_phone)?;

    // Look up the active trip for this vehicle
    let trip = trips::get_active_trip_by_vehicle_short_id(&state.db, &req.vehicle_short_id)
        .await?
        .ok_or(AppError::NotFound(
            "No active trip on this vehicle. Ask conductor to set route first.".into(),
        ))?;

    // Idempotency: phone + trip + minute window prevents double-charge on re-tap
    let minute = chrono::Utc::now().format("%Y%m%d%H%M");
    let idempotency_key = format!("{}-{}-{}", phone, trip.trip_id, minute);

    // Already initiated?
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM payments WHERE idempotency_key = $1",
    )
    .bind(&idempotency_key)
    .fetch_optional(&state.db)
    .await?;

    if let Some(e) = existing {
        return Ok(Json(InitiatePaymentResponse {
            success: true,
            message: "Payment already initiated — check your phone.".into(),
            payment_id: e.0,
        }));
    }

    // Fire STK Push via Daraja
    let daraja = DarajaService::new(&state.config);
    let stk_resp = daraja
        .stk_push(
            &phone,
            trip.fare_kes,
            &trip.paybill_no,
            &format!("Fare: {} to {}", trip.route, trip.destination),
            &trip.trip_id.to_string(),
        )
        .await?;

    // In sandbox mode, mask the phone number so real numbers aren't stored
    // in the database for a demo that can't process real payments.
    let stored_phone = if state.config.is_sandbox() {
        mask_phone(&phone)
    } else {
        phone.clone()
    };

    // Record the pending payment
    let payment = payments::create_pending_payment(
        &state.db,
        trip.trip_id,
        &stored_phone,
        trip.fare_kes * 100, // store in cents
        "stk",
        Some(&stk_resp.checkout_request_id),
        &idempotency_key,
    )
    .await?;

    let message = if state.config.is_sandbox() {
        format!(
            "Demo mode: payment of Ksh {} for {} has been simulated. No real M-Pesa prompt will arrive.",
            trip.fare_kes, trip.destination
        )
    } else {
        format!(
            "Check your phone — enter M-Pesa PIN to pay Ksh {} for {}",
            trip.fare_kes, trip.destination
        )
    };

    Ok(Json(InitiatePaymentResponse {
        success: true,
        message,
        payment_id: payment.id,
    }))
}

/// Normalise a Kenyan phone number to the "254…" format Daraja expects.
fn normalize_phone(phone: &str) -> Result<String, AppError> {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.len() {
        9 => Ok(format!("254{}", digits)),                              // 712345678
        10 if digits.starts_with('0') => Ok(format!("254{}", &digits[1..])), // 0712345678
        12 if digits.starts_with("254") => Ok(digits),                  // 254712345678
        _ => Err(AppError::BadRequest(
            "Invalid phone number format".into(),
        )),
    }
}

/// Public version for USSD handler to reuse phone normalisation.
pub fn normalize_phone_pub(phone: &str) -> Result<String, AppError> {
    normalize_phone(phone)
}

/// Mask a phone number for sandbox storage: "254712345678" → "2547XXXX5678"
fn mask_phone(phone: &str) -> String {
    if phone.len() >= 8 {
        let prefix = &phone[..4];
        let suffix = &phone[phone.len() - 4..];
        format!("{}XXXX{}", prefix, suffix)
    } else {
        "XXXX".to_string()
    }
}

/// Public version for USSD handler to reuse phone masking.
pub fn mask_phone_pub(phone: &str) -> String {
    mask_phone(phone)
}
