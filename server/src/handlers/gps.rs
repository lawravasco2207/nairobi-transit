use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{db::transit as transit_db, error::AppError, AppState};

#[derive(Deserialize)]
pub struct GpsPingPayload {
    /// Conductor phone number (used to look up vehicle assignment).
    pub phone: String,
    /// The active trip ID (acts as a non-guessable auth token for GPS pings).
    pub trip_id: Uuid,
    pub lat: f64,
    pub lon: f64,
    /// Optional compass heading (0–360°).
    pub heading: Option<f64>,
}

#[derive(Serialize)]
pub struct GpsPingResponse {
    pub success: bool,
    pub message: String,
}

/// POST /api/conductor/location
/// Conductor device sends a GPS ping every ~30 seconds.
/// The trip_id acts as a lightweight auth token (non-guessable UUID).
pub async fn update_location(
    State(state): State<AppState>,
    Json(payload): Json<GpsPingPayload>,
) -> Result<Json<GpsPingResponse>, AppError> {
    // Validate coordinates (Nairobi bounding box, ~±2° buffer)
    if payload.lat < -3.5 || payload.lat > 1.5 || payload.lon < 35.0 || payload.lon > 39.0 {
        return Err(AppError::BadRequest("Coordinates out of range for Kenya".into()));
    }

    // Resolve vehicle by phone + trip_id together (prevents spoofing)
    let row: Option<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        SELECT v.id AS vehicle_id, t.id AS trip_id
        FROM conductors c
        JOIN vehicles v  ON v.id = c.vehicle_id
        JOIN trips t     ON t.vehicle_id = v.id AND t.status = 'active'
        WHERE c.phone = $1 AND t.id = $2
        LIMIT 1
        "#,
    )
    .bind(&payload.phone)
    .bind(payload.trip_id)
    .fetch_optional(&state.db)
    .await?;

    let (vehicle_id, trip_id) = row.ok_or_else(|| {
        AppError::NotFound(
            "No active trip found for this phone + trip_id combination. Start a trip first.".into(),
        )
    })?;

    transit_db::upsert_vehicle_location(
        &state.db,
        vehicle_id,
        trip_id,
        payload.lat,
        payload.lon,
        payload.heading,
    )
    .await?;

    // Broadcast location update via WebSocket so the conductor dashboard can reflect it
    let event = serde_json::json!({
        "event": "location_update",
        "vehicle_id": vehicle_id,
        "lat": payload.lat,
        "lon": payload.lon,
    });
    let _ = state.ws_tx.send(event.to_string());

    Ok(Json(GpsPingResponse {
        success: true,
        message: "Location updated".into(),
    }))
}
