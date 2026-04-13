use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A trip record — one per active journey on a vehicle.
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Trip {
    pub id: Uuid,
    pub vehicle_id: Uuid,
    pub conductor_id: Uuid,
    pub route: String,
    pub destination: String,
    pub fare_amount: i32, // KES cents
    pub status: String,   // "active" | "ended"
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

/// What conductor POSTs to start or update a trip.
#[derive(Debug, Deserialize)]
pub struct TripUpdateRequest {
    pub route: String,
    pub destination: String,
    pub fare_amount: i32, // full KES (we convert to cents in handler)
}

/// Returned to QR scanner / USSD prompt — human-readable trip summary.
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct TripInfo {
    pub trip_id: Uuid,
    pub vehicle_short_id: String,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,    // human-readable KES
    pub paybill_no: String,
}
