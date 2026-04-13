use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

/// A transit stop (matatu stage or landmark).
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct TransitStop {
    pub id: i32,
    pub name: String,
    pub stage_name: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

/// Same as TransitStop but includes distance (used for /stops/nearby).
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct NearbyStop {
    pub id: i32,
    pub name: String,
    pub stage_name: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub distance_m: f64,
}

/// A transit route with boarding info.
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct TransitRoute {
    pub id: i32,
    pub route_number: String,
    pub route_name: String,
    pub origin: String,
    pub destination: String,
    pub stage: Option<String>,
    pub stage_lat: Option<f64>,
    pub stage_lon: Option<f64>,
    pub typical_fare_min: Option<i32>,
    pub typical_fare_max: Option<i32>,
}

/// A single leg of a journey (one matatu).
#[derive(Debug, Serialize, Clone)]
pub struct RouteLeg {
    pub leg_number: u32,
    pub route_number: String,
    pub route_name: String,
    pub board_at: String,
    pub board_stage: Option<String>,
    pub board_lat: Option<f64>,
    pub board_lon: Option<f64>,
    pub alight_at: String,
    pub fare_kes: i32,
    pub est_minutes: i32,
    pub stops: Vec<LegStop>,
}

/// A stop within a journey leg, used for the map polyline.
#[derive(Debug, Serialize, Clone)]
pub struct LegStop {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub sequence: i32,
}

/// A complete A→B journey plan (may have multiple legs/transfers).
#[derive(Debug, Serialize, Clone)]
pub struct RoutePlan {
    pub legs: Vec<RouteLeg>,
    pub total_fare_kes: i32,
    pub total_minutes: i32,
    pub transfers: usize,
    pub summary: String,
}

/// Raw row from the direct-route query.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DirectRouteRow {
    pub route_id: i32,
    pub route_number: String,
    pub route_name: String,
    pub stage: Option<String>,
    pub stage_lat: Option<f64>,
    pub stage_lon: Option<f64>,
    pub fare_kes: i32,
    pub from_stop_name: String,
    pub to_stop_name: String,
    pub seq_diff: i32,
}

/// Raw row from the transfer-route query.
#[derive(Debug, Clone, sqlx::FromRow)]
#[allow(dead_code)]
pub struct TransferRouteRow {
    pub route1_id: i32,
    pub route1_number: String,
    pub route1_name: String,
    pub stage1: Option<String>,
    pub stage1_lat: Option<f64>,
    pub stage1_lon: Option<f64>,
    pub fare1_kes: i32,
    pub from_stop_name: String,
    pub transfer_stop_name: String,
    pub transfer_lat: f64,
    pub transfer_lon: f64,
    pub route2_id: i32,
    pub route2_number: String,
    pub route2_name: String,
    pub stage2: Option<String>,
    pub stage2_lat: Option<f64>,
    pub stage2_lon: Option<f64>,
    pub fare2_kes: i32,
    pub to_stop_name: String,
    pub leg1_seq_diff: i32,
    pub leg2_seq_diff: i32,
}

/// Live vehicle location for the map.
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct LiveVehicle {
    pub vehicle_id: Uuid,
    pub short_id: String,
    pub route: String,
    pub destination: String,
    pub lat: f64,
    pub lon: f64,
    pub updated_seconds_ago: i64,
}

/// Journey info for passenger tracker.
#[derive(Debug, Serialize, Clone)]
pub struct JourneyInfo {
    pub payment_id: Uuid,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,
    pub vehicle_lat: Option<f64>,
    pub vehicle_lon: Option<f64>,
    pub vehicle_updated_seconds_ago: Option<i64>,
    pub route_stops: Vec<LegStop>,
    pub status: String, // "tracking" | "arrived" | "payment_pending"
}

/// Active route report (crowdsourced alert).
#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct RouteReport {
    pub id: Uuid,
    pub report_type: String,
    pub description: String,
    pub confirmed_by_conductor: bool,
    pub upvotes: i32,
    pub created_at: DateTime<Utc>,
}

/// Stop row used when fetching stops along a route (for journey display).
#[derive(Debug, Clone, sqlx::FromRow)]
#[allow(dead_code)]
pub struct RouteStopRow {
    pub stop_id: i32,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub stop_sequence: i32,
}
