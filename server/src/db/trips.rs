use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::trip::{Trip, TripInfo};

/// Look up the active trip for a vehicle by its short_id.
/// Used by both the QR scan flow and the USSD flow.
pub async fn get_active_trip_by_vehicle_short_id(
    pool: &PgPool,
    short_id: &str,
) -> Result<Option<TripInfo>> {
    let row: Option<TripInfo> = sqlx::query_as(
        r#"
        SELECT t.id    AS trip_id,
               v.short_id AS vehicle_short_id,
               t.route,
               t.destination,
               t.fare_amount / 100 AS fare_kes,
               v.paybill_no
        FROM trips t
        JOIN vehicles v ON v.id = t.vehicle_id
        WHERE v.short_id = $1 AND t.status = 'active'
        LIMIT 1
        "#,
    )
    .bind(short_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Upsert a trip: end any existing active trip for this vehicle, then create a new one.
/// Ensures only one active trip per vehicle at all times.
pub async fn upsert_trip(
    pool: &PgPool,
    vehicle_id: Uuid,
    conductor_id: Uuid,
    route: &str,
    destination: &str,
    fare_cents: i32,
) -> Result<Trip> {
    // End any existing active trip first
    sqlx::query(
        "UPDATE trips SET status = 'ended', ended_at = NOW() WHERE vehicle_id = $1 AND status = 'active'",
    )
    .bind(vehicle_id)
    .execute(pool)
    .await?;

    // Create a fresh trip
    let trip: Trip = sqlx::query_as(
        r#"
        INSERT INTO trips (id, vehicle_id, conductor_id, route, destination, fare_amount)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(vehicle_id)
    .bind(conductor_id)
    .bind(route)
    .bind(destination)
    .bind(fare_cents)
    .fetch_one(pool)
    .await?;

    Ok(trip)
}
