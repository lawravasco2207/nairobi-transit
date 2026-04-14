use axum::{extract::State, Json};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    db::vehicles::{insert_conductor, insert_vehicle},
    domain::vehicle::{RegisterConductorRequest, RegisterVehicleRequest},
    error::AppError,
    services::vehicle_code::generate_vehicle_short_id,
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
    let plate = req.plate.trim().to_uppercase();
    let sacco_name = req.sacco_name.trim().to_string();
    let paybill_no = req.paybill_no.trim().to_string();
    let legacy_short_id = req.short_id.as_deref().map(str::trim).filter(|value| !value.is_empty());

    if plate.is_empty() || sacco_name.is_empty() || paybill_no.is_empty() {
        return Err(AppError::BadRequest("All fields are required".into()));
    }

    if let Some(short_id) = legacy_short_id {
        tracing::debug!(supplied_short_id = %short_id, "Ignoring client-supplied vehicle code during registration");
    }

    let vehicle = loop {
        let short_id = generate_vehicle_short_id(&state.db, &plate, &sacco_name)
            .await
            .map_err(AppError::Internal)?;

        match insert_vehicle(&state.db, &plate, &short_id, &sacco_name, &paybill_no).await {
            Ok(vehicle) => break vehicle,
            Err(e) => {
                let message = e.to_string();
                if message.contains("vehicles_plate_key") || message.contains("duplicate key") && message.contains("plate") {
                    return Err(AppError::BadRequest(format!(
                        "Vehicle with plate '{}' already exists",
                        plate
                    )));
                }
                if message.contains("vehicles_short_id_key") || message.contains("duplicate key") && message.contains("short_id") {
                    continue;
                }
                return Err(AppError::Internal(e));
            }
        }
    };

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
