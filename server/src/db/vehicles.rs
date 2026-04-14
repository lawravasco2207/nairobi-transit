use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::vehicle::Vehicle;

/// Look up a vehicle by its short_id (the code printed on the seat sticker).
#[allow(dead_code)]
pub async fn get_vehicle_by_short_id(pool: &PgPool, short_id: &str) -> Result<Option<Vehicle>> {
    let vehicle: Option<Vehicle> = sqlx::query_as(
        r#"SELECT id, plate, short_id, sacco_name, paybill_no FROM vehicles WHERE short_id = $1"#,
    )
    .bind(short_id)
    .fetch_optional(pool)
    .await?;

    Ok(vehicle)
}

pub async fn short_id_exists(pool: &PgPool, short_id: &str) -> Result<bool> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(SELECT 1 FROM vehicles WHERE short_id = $1)"#,
    )
    .bind(short_id)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

/// Register a new vehicle (matatu) in the system.
pub async fn insert_vehicle(
    pool: &PgPool,
    plate: &str,
    short_id: &str,
    sacco_name: &str,
    paybill_no: &str,
) -> Result<Vehicle> {
    let vehicle: Vehicle = sqlx::query_as(
        r#"INSERT INTO vehicles (id, plate, short_id, sacco_name, paybill_no)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           RETURNING id, plate, short_id, sacco_name, paybill_no"#,
    )
    .bind(plate)
    .bind(short_id)
    .bind(sacco_name)
    .bind(paybill_no)
    .fetch_one(pool)
    .await?;

    Ok(vehicle)
}

/// Register a new conductor linked to a vehicle.
pub async fn insert_conductor(
    pool: &PgPool,
    phone: &str,
    name: &str,
    vehicle_id: Uuid,
    pin_hash: &str,
) -> Result<(Uuid, String, String)> {
    let row: (Uuid, String, String) = sqlx::query_as(
        r#"INSERT INTO conductors (id, phone, name, vehicle_id, pin_hash)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           RETURNING id, phone, name"#,
    )
    .bind(phone)
    .bind(name)
    .bind(vehicle_id)
    .bind(pin_hash)
    .fetch_one(pool)
    .await?;

    Ok(row)
}
