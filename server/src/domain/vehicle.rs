use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A registered matatu (vehicle) in the system.
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Vehicle {
    pub id: Uuid,
    pub plate: String,
    pub short_id: String,   // "NRB23" — used in USSD *384*NRB23#
    pub sacco_name: String,
    pub paybill_no: String,
}

/// What a SACCO/owner POSTs to register a new matatu.
#[derive(Debug, Deserialize)]
pub struct RegisterVehicleRequest {
    pub plate: String,       // e.g. "KDA 123A"
    pub short_id: String,    // e.g. "NRB23"
    pub sacco_name: String,
    pub paybill_no: String,
}

/// What a conductor POSTs to register themselves on a vehicle.
#[derive(Debug, Deserialize)]
pub struct RegisterConductorRequest {
    pub phone: String,              // "+254712345678"
    pub name: String,
    pub vehicle_short_id: String,   // link to vehicle by short_id
    pub pin: String,                // plain PIN — hashed server-side
}
