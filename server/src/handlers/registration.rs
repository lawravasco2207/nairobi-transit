use axum::{extract::State, Json};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    db::vehicles::{insert_conductor, insert_vehicle},
    domain::vehicle::{RegisterConductorRequest, RegisterVehicleRequest},
    error::AppError,
    AppState,
};

// ── Vehicle registration ────────────────────────────────────────

#[derive(Serialize)]
pub struct RegisterVehicleResponse {
    pub success: bool,
    pub vehicle_id: Uuid,
    pub short_id: String,
    pub ussd_code: String,
    pub message: String,
}

/// POST /api/vehicles/register
/// SACCO or vehicle owner registers a new matatu on the platform.
pub async fn register_vehicle(
    State(state): State<AppState>,
    Json(req): Json<RegisterVehicleRequest>,
) -> Result<Json<RegisterVehicleResponse>, AppError> {
    if req.plate.is_empty() || req.short_id.is_empty() || req.sacco_name.is_empty() || req.paybill_no.is_empty() {
        return Err(AppError::BadRequest("All fields are required".into()));
    }

    let vehicle = insert_vehicle(&state.db, &req.plate, &req.short_id, &req.sacco_name, &req.paybill_no)
        .await
        .map_err(|e| {
            if e.to_string().contains("duplicate key") {
                AppError::BadRequest(format!(
                    "Vehicle with plate '{}' or short_id '{}' already exists",
                    req.plate, req.short_id
                ))
            } else {
                AppError::Internal(e)
            }
        })?;

    tracing::info!(
        vehicle_id = %vehicle.id,
        plate = %vehicle.plate,
        short_id = %vehicle.short_id,
        "Vehicle registered"
    );

    Ok(Json(RegisterVehicleResponse {
        success: true,
        vehicle_id: vehicle.id,
        ussd_code: format!("*384*{}#", vehicle.short_id),
        short_id: vehicle.short_id,
        message: format!("Vehicle {} registered successfully", vehicle.plate),
    }))
}

// ── Conductor registration ──────────────────────────────────────

#[derive(Serialize)]
pub struct RegisterConductorResponse {
    pub success: bool,
    pub conductor_id: Uuid,
    pub vehicle_id: Uuid,
    pub message: String,
}

/// POST /api/conductors/register
/// Conductor registers themselves and links to a vehicle by its short_id.
pub async fn register_conductor(
    State(state): State<AppState>,
    Json(req): Json<RegisterConductorRequest>,
) -> Result<Json<RegisterConductorResponse>, AppError> {
    if req.phone.is_empty() || req.name.is_empty() || req.pin.is_empty() || req.vehicle_short_id.is_empty() {
        return Err(AppError::BadRequest("All fields are required".into()));
    }

    if req.pin.len() < 4 {
        return Err(AppError::BadRequest("PIN must be at least 4 digits".into()));
    }

    // Resolve vehicle by short_id
    let vehicle: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM vehicles WHERE short_id = $1",
    )
    .bind(&req.vehicle_short_id)
    .fetch_optional(&state.db)
    .await?;

    let vehicle_id = vehicle
        .ok_or_else(|| AppError::NotFound(format!("Vehicle '{}' not found", req.vehicle_short_id)))?
        .0;

    // Hash the PIN (bcrypt cost 12 — fast enough for registration, secure for storage)
    let pin_hash = bcrypt::hash(&req.pin, 12)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to hash PIN: {}", e)))?;

    let (conductor_id, phone, name) =
        insert_conductor(&state.db, &req.phone, &req.name, vehicle_id, &pin_hash)
            .await
            .map_err(|e| {
                if e.to_string().contains("duplicate key") {
                    AppError::BadRequest(format!("Conductor with phone '{}' already exists", req.phone))
                } else {
                    AppError::Internal(e)
                }
            })?;

    tracing::info!(
        conductor_id = %conductor_id,
        phone = %phone,
        name = %name,
        vehicle_short_id = %req.vehicle_short_id,
        "Conductor registered"
    );

    Ok(Json(RegisterConductorResponse {
        success: true,
        conductor_id,
        vehicle_id,
        message: format!("Conductor {} registered on vehicle {}", name, req.vehicle_short_id),
    }))
}
