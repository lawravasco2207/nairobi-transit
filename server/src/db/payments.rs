use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::payment::Payment;

/// Insert a new pending payment. Called after STK push is fired.
pub async fn create_pending_payment(
    pool: &PgPool,
    trip_id: Uuid,
    passenger_phone: &str,
    amount_cents: i32,
    channel: &str,
    checkout_request_id: Option<&str>,
    idempotency_key: &str,
) -> Result<Payment> {
    let payment: Payment = sqlx::query_as(
        r#"
        INSERT INTO payments
            (id, trip_id, passenger_phone, amount, channel,
             checkout_request_id, idempotency_key)
        VALUES
            (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
    )
    .bind(trip_id)
    .bind(passenger_phone)
    .bind(amount_cents)
    .bind(channel)
    .bind(checkout_request_id)
    .bind(idempotency_key)
    .fetch_one(pool)
    .await?;

    Ok(payment)
}

/// Confirm a payment when Daraja webhook reports success.
/// Only transitions "pending" → "confirmed" to prevent double-processing.
pub async fn confirm_payment(
    pool: &PgPool,
    checkout_request_id: &str,
    mpesa_ref: &str,
) -> Result<Option<Payment>> {
    let payment: Option<Payment> = sqlx::query_as(
        r#"
        UPDATE payments
        SET status = 'confirmed',
            mpesa_ref = $1,
            confirmed_at = NOW()
        WHERE checkout_request_id = $2
          AND status = 'pending'
        RETURNING *
        "#,
    )
    .bind(mpesa_ref)
    .bind(checkout_request_id)
    .fetch_optional(pool)
    .await?;

    Ok(payment)
}
