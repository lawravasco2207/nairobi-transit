use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;

use crate::{error::AppError, services::qr_generator::generate_qr_base64, AppState};

/// Response containing trip info plus a base64-encoded QR code image.
#[derive(Serialize)]
pub struct QrResponse {
    pub vehicle_short_id: String,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,
    pub qr_image_base64: String, // render as <img src="…">
    pub ussd_fallback: String,
}

/// GET /api/qr/:vehicle_short_id
/// Returns trip info + QR code for the conductor's dashboard/tablet.
pub async fn get_qr(
    State(state): State<AppState>,
    Path(vehicle_short_id): Path<String>,
) -> Result<Json<QrResponse>, AppError> {
    let trip = crate::db::trips::get_active_trip_by_vehicle_short_id(&state.db, &vehicle_short_id)
        .await?
        .ok_or(AppError::NotFound(
            "No active trip for this vehicle".into(),
        ))?;

    let qr_image_base64 = generate_qr_base64(&vehicle_short_id, &state.config.qr_base_url)?;

    Ok(Json(QrResponse {
        vehicle_short_id: vehicle_short_id.clone(),
        route: trip.route,
        destination: trip.destination,
        fare_kes: trip.fare_kes,
        qr_image_base64,
        ussd_fallback: format!("*384*{}#", vehicle_short_id),
    }))
}
