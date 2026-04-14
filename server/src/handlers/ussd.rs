use axum::{extract::State, Form};
use serde::Deserialize;

use crate::{cache::session::UssdSession, error::AppError, AppState};

/// Africa's Talking sends these fields on every USSD request.
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct UssdRequest {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "phoneNumber")]
    pub phone_number: String,
    #[serde(rename = "networkCode")]
    pub network_code: String,
    #[serde(rename = "serviceCode")]
    pub service_code: String, // e.g. "*384*NCH23#"
    pub text: String,         // accumulates: "" → "1" → "1*0712345678" → "1*0712345678*1"
}

/// POST /api/ussd
/// Returns plain text — "CON " prefix = more menus, "END " = session ends.
pub async fn handle_ussd(State(state): State<AppState>, Form(req): Form<UssdRequest>) -> String {
    match process_ussd(&state, &req).await {
        Ok(response) => response,
        Err(e) => {
            tracing::error!("USSD error: {:?}", e);
            "END Sorry, service temporarily unavailable. Please try again.".to_string()
        }
    }
}

/// Multi-step USSD flow:
///   0. Show trip info → "1. Pay  2. Cancel"
///   1. Ask phone number
///   2. Confirm payment
///   3. Fire STK Push
async fn process_ussd(state: &AppState, req: &UssdRequest) -> Result<String, AppError> {
    let vehicle_short_id = extract_vehicle_id(&req.service_code)
        .ok_or(AppError::BadRequest("Invalid USSD code".into()))?;

    let steps: Vec<&str> = req.text.split('*').filter(|s| !s.is_empty()).collect();

    // ── STEP 0: Initial dial — show trip info ───────────────────────
    if req.text.is_empty() {
        let trip =
            crate::db::trips::get_active_trip_by_vehicle_short_id(&state.db, vehicle_short_id)
                .await?;

        return match trip {
            None => Ok(
                "END This vehicle has no active trip set.\nAsk conductor to update route info."
                    .to_string(),
            ),
            Some(t) => {
                // Cache session with trip info for subsequent steps
                let session = UssdSession {
                    trip_id: t.trip_id,
                    vehicle_short_id: vehicle_short_id.to_string(),
                    route: t.route.clone(),
                    destination: t.destination.clone(),
                    fare_kes: t.fare_kes,
                    paybill_no: t.paybill_no.clone(),
                    passenger_phone: String::new(),
                };
                state
                    .cache
                    .save_ussd_session(&req.session_id, &session)
                    .await?;

                Ok(format!(
                    "CON Route: {}\nTo: {}\nFare: Ksh {}\n\n1. Pay now\n2. Cancel",
                    t.route, t.destination, t.fare_kes
                ))
            }
        };
    }

    // ── STEP 1: Pay or cancel ───────────────────────────────────────
    if steps.len() == 1 {
        return match steps[0] {
            "1" => Ok("CON Enter your Safaricom number\n(e.g. 0712345678):".to_string()),
            "2" => Ok("END Cancelled. No charge made.".to_string()),
            _ => Ok("END Invalid option. Please try again.".to_string()),
        };
    }

    // ── STEP 2: Phone number entered — show confirmation ────────────
    if steps.len() == 2 && steps[0] == "1" {
        let phone_input = steps[1];
        let session = state
            .cache
            .get_ussd_session(&req.session_id)
            .await?
            .ok_or(AppError::NotFound("Session expired".into()))?;

        return Ok(format!(
            "CON Confirm payment:\nKsh {} → {}\nPhone: {}\n\n1. Confirm\n2. Cancel",
            session.fare_kes, session.destination, phone_input
        ));
    }

    // ── STEP 3: Final confirmation — fire STK Push ──────────────────
    if steps.len() == 3 && steps[0] == "1" {
        let phone_input = steps[1];
        let confirmed = steps[2];

        if confirmed != "1" {
            return Ok("END Cancelled. No charge made.".to_string());
        }

        let phone = crate::handlers::stk::normalize_phone_pub(phone_input)
            .map_err(|_| AppError::BadRequest("Invalid phone number".into()))?;

        let session = state
            .cache
            .get_ussd_session(&req.session_id)
            .await?
            .ok_or(AppError::NotFound(
                "Session expired. Please dial again.".into(),
            ))?;

        // Fire STK Push
        let daraja = crate::services::daraja::DarajaService::new(&state.config);
        let minute = chrono::Utc::now().format("%Y%m%d%H%M");
        let idempotency_key = format!("{}-{}-{}", phone, session.trip_id, minute);

        let stk_resp = daraja
            .stk_push(
                &phone,
                session.fare_kes,
                &session.paybill_no,
                &format!("Fare: {} to {}", session.route, session.destination),
                &session.trip_id.to_string(),
            )
            .await?;

        // In sandbox mode, mask the phone number stored in the database
        let stored_phone = if state.config.is_sandbox() {
            crate::handlers::stk::mask_phone_pub(&phone)
        } else {
            phone.clone()
        };

        // Record pending payment
        crate::db::payments::create_pending_payment(
            &state.db,
            session.trip_id,
            &stored_phone,
            session.fare_kes * 100,
            "ussd",
            Some(&stk_resp.checkout_request_id),
            &idempotency_key,
        )
        .await?;

        // Clean up session
        let _ = state.cache.delete_ussd_session(&req.session_id).await;

        return Ok(format!(
            "END Ksh {} payment initiated.\nEnter M-Pesa PIN on your phone.\nDo NOT close until complete.",
            session.fare_kes
        ));
    }

    Ok("END Invalid input. Please dial again.".to_string())
}

/// Extract vehicle short_id from USSD service code.
/// "*384*NCH23#" → "NCH23"
fn extract_vehicle_id(service_code: &str) -> Option<&str> {
    let inner = service_code.trim_start_matches('*').trim_end_matches('#');
    let parts: Vec<&str> = inner.split('*').collect();
    parts.get(1).copied()
}
