use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A payment record — tracks every fare transaction end-to-end.
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Payment {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub passenger_phone: String,
    pub amount: i32,                          // KES cents
    pub channel: String,                      // "stk" | "ussd"
    pub status: String,                       // "pending" | "confirmed" | "failed"
    pub mpesa_ref: Option<String>,
    pub checkout_request_id: Option<String>,
    pub idempotency_key: String,
    pub created_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
}

/// Fired to conductor WebSocket when a payment is confirmed.
#[derive(Debug, Serialize, Clone)]
pub struct PaymentConfirmedEvent {
    pub event: String,            // "payment_confirmed"
    pub passenger_phone: String,
    pub amount_kes: i32,
    pub mpesa_ref: String,
    pub channel: String,
    pub trip_id: Uuid,
}
