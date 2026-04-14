use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::transit::{
    DirectRouteRow, LiveVehicle, NearbyStop, RouteReport, RouteStopRow, TransferRouteRow,
    TransitRoute, TransitStop,
};

// ── Stop Queries ──────────────────────────────────────────────────────────────

/// Find stops within `radius_m` metres of lat/lon, ordered by distance.
/// Uses Haversine formula — no PostGIS required, works on any PostgreSQL.
/// Bounding-box pre-filter uses the lat/lon B-tree indexes for speed.
/// Caps at 30 results.
pub async fn find_stops_near(
    pool: &PgPool,
    lat: f64,
    lon: f64,
    radius_m: f64,
) -> Result<Vec<NearbyStop>> {
    // Pre-filter bounding box in degrees (1 degree lat ≈ 111 320 m)
    let lat_margin = radius_m / 111_320.0;
    let lon_margin = radius_m / (111_320.0 * (lat * std::f64::consts::PI / 180.0).cos().abs().max(0.001));

    let rows = sqlx::query_as::<_, NearbyStop>(
        r#"
        SELECT
            id, name, stage_name, lat, lon,
            6371000 * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS(($1 - lat) / 2)), 2) +
                COS(RADIANS($1)) * COS(RADIANS(lat)) *
                POWER(SIN(RADIANS(($2 - lon) / 2)), 2)
            )) AS distance_m
        FROM transit_stops
        WHERE lat BETWEEN $3 AND $4
          AND lon BETWEEN $5 AND $6
          AND 6371000 * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS(($1 - lat) / 2)), 2) +
                COS(RADIANS($1)) * COS(RADIANS(lat)) *
                POWER(SIN(RADIANS(($2 - lon) / 2)), 2)
              )) <= $7
        ORDER BY distance_m
        LIMIT 30
        "#,
    )
    .bind(lat)
    .bind(lon)
    .bind(lat - lat_margin)
    .bind(lat + lat_margin)
    .bind(lon - lon_margin)
    .bind(lon + lon_margin)
    .bind(radius_m)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Text search: match stop name, stage_name, or any landmark alias.
/// Uses a two-pass approach: exact LIKE match first, then trigram similarity
/// fallback (via pg_trgm) so area names like "CBD", "Westlands" are found even
/// when no stop name literally contains those words.
pub async fn find_stops_by_text(pool: &PgPool, query: &str) -> Result<Vec<TransitStop>> {
    let pattern = format!("%{}%", query.to_lowercase());
    let lower_q = query.to_lowercase();
    let rows = sqlx::query_as::<_, TransitStop>(
        r#"
        SELECT id, name, stage_name, lat, lon FROM (
            SELECT id, name, stage_name, lat, lon, 0 AS pass
            FROM transit_stops
            WHERE lower(name) LIKE $1
               OR lower(COALESCE(stage_name, '')) LIKE $1
               OR EXISTS (
                   SELECT 1 FROM unnest(landmark_aliases) la
                   WHERE lower(la) LIKE $1
               )
            UNION ALL
            SELECT id, name, stage_name, lat, lon, 1 AS pass
            FROM transit_stops
            WHERE NOT (
                      lower(name) LIKE $1
                   OR lower(COALESCE(stage_name, '')) LIKE $1
                   OR EXISTS (
                       SELECT 1 FROM unnest(landmark_aliases) la
                       WHERE lower(la) LIKE $1
                   )
              )
              AND (
                  similarity(lower(name), $2) > 0.25
               OR EXISTS (
                   SELECT 1 FROM unnest(landmark_aliases) la
                   WHERE similarity(lower(la), $2) > 0.35
               )
              )
        ) sub
        ORDER BY
            pass,
            CASE WHEN lower(name) = $2 THEN 0
                 WHEN lower(name) LIKE $1 THEN 1
                 ELSE 2 END,
            name
        LIMIT 8
        "#,
    )
    .bind(&pattern)
    .bind(&lower_q)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Get all stops for a specific transit route, in sequence order.
pub async fn get_stops_on_route(pool: &PgPool, route_id: i32) -> Result<Vec<RouteStopRow>> {
    let rows = sqlx::query_as::<_, RouteStopRow>(
        r#"
        SELECT s.id AS stop_id, s.name, s.lat, s.lon, rs.stop_sequence
        FROM route_stops rs
        JOIN transit_stops s ON s.id = rs.stop_id
        WHERE rs.route_id = $1
        ORDER BY rs.stop_sequence
        "#,
    )
    .bind(route_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

// ── Route Planning Queries ────────────────────────────────────────────────────

/// Find all routes that pass through BOTH a stop in origin_ids and a stop in dest_ids,
/// in the correct order (origin before destination).
pub async fn find_direct_routes(
    pool: &PgPool,
    origin_ids: &[i32],
    dest_ids: &[i32],
) -> Result<Vec<DirectRouteRow>> {
    let rows = sqlx::query_as::<_, DirectRouteRow>(
        r#"
        SELECT DISTINCT ON (r.id)
            r.id                    AS route_id,
            r.route_number,
            r.route_name,
            r.stage,
            r.stage_lat,
            r.stage_lon,
            COALESCE(r.typical_fare_max, 60) AS fare_kes,
            s_from.name             AS from_stop_name,
            s_to.name               AS to_stop_name,
            rs_from.stop_sequence   AS from_stop_sequence,
            rs_to.stop_sequence     AS to_stop_sequence
        FROM transit_routes r
        JOIN route_stops rs_from ON rs_from.route_id = r.id
            AND rs_from.stop_id = ANY($1)
        JOIN route_stops rs_to ON rs_to.route_id = r.id
            AND rs_to.stop_id = ANY($2)
            AND rs_to.stop_sequence > rs_from.stop_sequence
        JOIN transit_stops s_from ON s_from.id = rs_from.stop_id
        JOIN transit_stops s_to   ON s_to.id   = rs_to.stop_id
        ORDER BY r.id, rs_from.stop_sequence DESC
        LIMIT 5
        "#,
    )
    .bind(origin_ids)
    .bind(dest_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Find 1-transfer routes: route_1 from origin → transfer_stop, route_2 from transfer_stop → dest.
pub async fn find_transfer_routes(
    pool: &PgPool,
    origin_ids: &[i32],
    dest_ids: &[i32],
) -> Result<Vec<TransferRouteRow>> {
    let rows = sqlx::query_as::<_, TransferRouteRow>(
        r#"
        SELECT DISTINCT ON (r1.id, r2.id)
            r1.id                       AS route1_id,
            r1.route_number             AS route1_number,
            r1.route_name               AS route1_name,
            r1.stage                    AS stage1,
            r1.stage_lat                AS stage1_lat,
            r1.stage_lon                AS stage1_lon,
            COALESCE(r1.typical_fare_max, 60) AS fare1_kes,
            s_from.name                 AS from_stop_name,
            s_xfer.name                 AS transfer_stop_name,
            s_xfer.lat                  AS transfer_lat,
            s_xfer.lon                  AS transfer_lon,
            rs_from.stop_sequence       AS from_stop_sequence,
            rs_xfer1.stop_sequence      AS transfer_stop_sequence_leg1,
            r2.id                       AS route2_id,
            r2.route_number             AS route2_number,
            r2.route_name               AS route2_name,
            r2.stage                    AS stage2,
            r2.stage_lat                AS stage2_lat,
            r2.stage_lon                AS stage2_lon,
            COALESCE(r2.typical_fare_max, 60) AS fare2_kes,
            s_to.name                   AS to_stop_name,
            rs_xfer2.stop_sequence      AS transfer_stop_sequence_leg2,
            rs_to.stop_sequence         AS to_stop_sequence,
            (rs_xfer1.stop_sequence - rs_from.stop_sequence) AS leg1_seq_diff,
            (rs_to.stop_sequence - rs_xfer2.stop_sequence)   AS leg2_seq_diff
        FROM transit_routes r1
        -- origin stop on route 1
        JOIN route_stops rs_from  ON rs_from.route_id = r1.id
            AND rs_from.stop_id = ANY($1)
        JOIN transit_stops s_from ON s_from.id = rs_from.stop_id
        -- transfer stop on route 1 (after origin)
        JOIN route_stops rs_xfer1 ON rs_xfer1.route_id = r1.id
            AND rs_xfer1.stop_sequence > rs_from.stop_sequence
        JOIN transit_stops s_xfer ON s_xfer.id = rs_xfer1.stop_id
        -- same transfer stop must exist on route 2
        JOIN route_stops rs_xfer2 ON rs_xfer2.stop_id = rs_xfer1.stop_id
            AND rs_xfer2.route_id <> r1.id
        JOIN transit_routes r2    ON r2.id = rs_xfer2.route_id
        -- destination stop on route 2 (after transfer)
        JOIN route_stops rs_to    ON rs_to.route_id = r2.id
            AND rs_to.stop_id = ANY($2)
            AND rs_to.stop_sequence > rs_xfer2.stop_sequence
        JOIN transit_stops s_to   ON s_to.id = rs_to.stop_id
        ORDER BY r1.id, r2.id, (rs_xfer1.stop_sequence - rs_from.stop_sequence) ASC
        LIMIT 5
        "#,
    )
    .bind(origin_ids)
    .bind(dest_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Find routes that serve a destination, ranked by relevance (for stage finder).
pub async fn find_routes_to_destination(
    pool: &PgPool,
    destination: &str,
) -> Result<Vec<TransitRoute>> {
    let pattern = format!("%{}%", destination.to_lowercase());
    let rows = sqlx::query_as::<_, TransitRoute>(
        r#"
        SELECT DISTINCT r.id, r.route_number, r.route_name, r.origin, r.destination,
               r.stage, r.stage_lat, r.stage_lon, r.typical_fare_min, r.typical_fare_max
        FROM transit_routes r
        WHERE lower(r.destination) LIKE $1
           OR lower(r.route_name)  LIKE $1
           OR EXISTS (
               SELECT 1 FROM route_stops rs
               JOIN transit_stops s ON s.id = rs.stop_id
               WHERE rs.route_id = r.id
                 AND (lower(s.name) LIKE $1
                   OR EXISTS (SELECT 1 FROM unnest(s.landmark_aliases) la WHERE lower(la) LIKE $1))
           )
        ORDER BY r.route_number::int NULLS LAST, r.route_number
        LIMIT 8
        "#,
    )
    .bind(&pattern)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

// ── Vehicle Location ──────────────────────────────────────────────────────────

/// Upsert (insert or update) the live location of a vehicle.
pub async fn upsert_vehicle_location(
    pool: &PgPool,
    vehicle_id: Uuid,
    trip_id: Uuid,
    lat: f64,
    lon: f64,
    heading: Option<f64>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO vehicle_locations (vehicle_id, trip_id, lat, lon, heading, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (vehicle_id) DO UPDATE
        SET trip_id = EXCLUDED.trip_id,
            lat     = EXCLUDED.lat,
            lon     = EXCLUDED.lon,
            heading = EXCLUDED.heading,
            updated_at = NOW()
        "#,
    )
    .bind(vehicle_id)
    .bind(trip_id)
    .bind(lat)
    .bind(lon)
    .bind(heading)
    .execute(pool)
    .await?;

    Ok(())
}

/// Fetch all vehicle locations updated in the last 3 minutes (live vehicles).
pub async fn get_live_vehicle_locations(pool: &PgPool) -> Result<Vec<LiveVehicle>> {
    let rows = sqlx::query_as::<_, LiveVehicle>(
        r#"
        SELECT
            vl.vehicle_id,
            v.short_id,
            COALESCE(t.route, 'Unknown') AS route,
            COALESCE(t.destination, 'Unknown') AS destination,
            vl.lat,
            vl.lon,
            EXTRACT(EPOCH FROM (NOW() - vl.updated_at))::BIGINT AS updated_seconds_ago
        FROM vehicle_locations vl
        JOIN vehicles v ON v.id = vl.vehicle_id
        LEFT JOIN trips t ON t.id = vl.trip_id AND t.status = 'active'
        WHERE vl.updated_at > NOW() - INTERVAL '3 minutes'
        ORDER BY vl.updated_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

// ── Journey Tracker ───────────────────────────────────────────────────────────

/// Raw row for journey tracker lookup.
#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
pub struct JourneyRaw {
    pub vehicle_id: Uuid,
    pub trip_id: Uuid,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,
    pub payment_status: String,
    pub vehicle_lat: Option<f64>,
    pub vehicle_lon: Option<f64>,
    pub updated_seconds_ago: Option<i64>,
}

pub async fn get_journey_raw(pool: &PgPool, payment_id: Uuid) -> Result<Option<JourneyRaw>> {
    let row = sqlx::query_as::<_, JourneyRaw>(
        r#"
        SELECT
            v.id   AS vehicle_id,
            t.id   AS trip_id,
            t.route,
            t.destination,
            p.amount / 100 AS fare_kes,
            p.status AS payment_status,
            vl.lat AS vehicle_lat,
            vl.lon AS vehicle_lon,
            EXTRACT(EPOCH FROM (NOW() - vl.updated_at))::BIGINT AS updated_seconds_ago
        FROM payments p
        JOIN trips    t  ON t.id  = p.trip_id
        JOIN vehicles v  ON v.id  = t.vehicle_id
        LEFT JOIN vehicle_locations vl ON vl.vehicle_id = v.id
        WHERE p.id = $1
        LIMIT 1
        "#,
    )
    .bind(payment_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

// ── Crowdsource Reports ───────────────────────────────────────────────────────

pub async fn insert_route_report(
    pool: &PgPool,
    report_type: &str,
    route_id: Option<i32>,
    stop_id: Option<i32>,
    description: &str,
    reporter_phone: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO route_reports
            (report_type, route_id, stop_id, description, reporter_phone)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(report_type)
    .bind(route_id)
    .bind(stop_id)
    .bind(description)
    .bind(reporter_phone)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_active_reports(pool: &PgPool) -> Result<Vec<RouteReport>> {
    let rows = sqlx::query_as::<_, RouteReport>(
        r#"
        SELECT id, report_type, description, confirmed_by_conductor, upvotes, created_at
        FROM route_reports
        WHERE expires_at > NOW()
        ORDER BY upvotes DESC, created_at DESC
        LIMIT 20
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
