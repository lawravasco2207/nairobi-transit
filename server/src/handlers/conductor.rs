use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{db::trips::upsert_trip, domain::trip::TripUpdateRequest, error::AppError, AppState};

/// Conductor authenticates with phone + PIN (verified against bcrypt hash in DB).
#[derive(Deserialize)]
pub struct ConductorAuth {
    pub phone: String,
    pub pin: String,
}

/// Full request body for trip creation / update.
#[derive(Deserialize)]
pub struct UpdateTripPayload {
    pub auth: ConductorAuth,
    pub trip: TripUpdateRequest,
}

/// Response confirming the trip was set.
#[derive(Serialize)]
pub struct UpdateTripResponse {
    pub success: bool,
    pub trip_id: Uuid,
    pub ussd_code: String, // e.g. "*384*NRB23#"
    pub qr_url: String,
    pub message: String,
}

/// POST /api/conductor/trip
/// Conductor sets the route, destination, and fare for the current trip.
/// Authenticates via phone number + 4-digit PIN.
pub async fn update_trip(
    State(state): State<AppState>,
    Json(payload): Json<UpdateTripPayload>,
) -> Result<Json<UpdateTripResponse>, AppError> {
    // Look up conductor by phone and get their vehicle assignment
    let conductor: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT c.id, c.vehicle_id, c.pin_hash FROM conductors c WHERE c.phone = $1",
    )
    .bind(&payload.auth.phone)
    .fetch_optional(&state.db)
    .await?;

    let (conductor_id, vehicle_id, pin_hash) = conductor.ok_or_else(|| {
        AppError::NotFound("Conductor not found. Check your phone number.".into())
    })?;

    // Verify PIN against stored bcrypt hash
    let pin_valid = bcrypt::verify(&payload.auth.pin, &pin_hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("PIN verification failed: {}", e)))?;

    if !pin_valid {
        return Err(AppError::BadRequest("Incorrect PIN".into()));
    }

    // Fetch vehicle short_id
    let vehicle: Option<(String,)> = sqlx::query_as(
        "SELECT short_id FROM vehicles WHERE id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(&state.db)
    .await?;

    let vehicle = vehicle.ok_or_else(|| {
        AppError::NotFound("No vehicle assigned to this conductor".into())
    })?;

    let fare_cents = payload.trip.fare_amount * 100;

    let trip = upsert_trip(
        &state.db,
        vehicle_id,
        conductor_id,
        &payload.trip.route,
        &payload.trip.destination,
        fare_cents,
    )
    .await?;

    let ussd_code = format!("*384*{}#", vehicle.0);
    let qr_url = format!("{}/{}", state.config.qr_base_url, vehicle.0);

    tracing::info!(
        trip_id = %trip.id,
        route = %trip.route,
        destination = %trip.destination,
        fare_kes = payload.trip.fare_amount,
        "Trip updated"
    );

    Ok(Json(UpdateTripResponse {
        success: true,
        trip_id: trip.id,
        ussd_code,
        qr_url,
        message: format!(
            "Trip set: {} → {} at Ksh {}",
            payload.trip.route, payload.trip.destination, payload.trip.fare_amount
        ),
    }))
}
