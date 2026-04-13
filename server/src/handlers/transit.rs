use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::transit as transit_db,
    domain::transit::{JourneyInfo, LegStop, RouteLeg, RoutePlan, RouteReport},
    error::AppError,
    AppState,
};

// ── Stop Text Search ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StopSearchQuery {
    pub q: String,
}

/// GET /api/transit/stops/search?q=Thika
/// Returns stops matching the query by name / alias (same logic as route planner).
/// Useful for resolving a place name to coordinates before querying nearby stops.
pub async fn search_stops(
    State(state): State<AppState>,
    Query(q): Query<StopSearchQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    if q.q.trim().is_empty() {
        return Err(AppError::BadRequest("q must not be empty".into()));
    }
    let stops = transit_db::find_stops_by_text(&state.db, q.q.trim()).await?;
    Ok(Json(serde_json::json!({ "stops": stops })))
}

// ── Nearby Stops ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct NearbyQuery {
    pub lat: f64,
    pub lon: f64,
    /// Search radius in metres (default 2000, max 5000)
    #[serde(default = "default_radius")]
    pub radius_m: f64,
}
fn default_radius() -> f64 { 2000.0 }

/// GET /api/transit/stops/nearby?lat=&lon=&radius_m=
pub async fn nearby_stops(
    State(state): State<AppState>,
    Query(q): Query<NearbyQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    if q.radius_m < 100.0 || q.radius_m > 5000.0 {
        return Err(AppError::BadRequest("radius_m must be 100–5000".into()));
    }
    let stops = transit_db::find_stops_near(&state.db, q.lat, q.lon, q.radius_m).await?;
    Ok(Json(serde_json::json!({ "stops": stops })))
}

// ── Route Planner ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PlanQuery {
    pub from: String,
    pub to: String,
}

/// GET /api/transit/route?from=Westlands&to=Buru+Buru
pub async fn plan_route(
    State(state): State<AppState>,
    Query(q): Query<PlanQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let from_stops = transit_db::find_stops_by_text(&state.db, &q.from).await?;
    let to_stops = transit_db::find_stops_by_text(&state.db, &q.to).await?;

    if from_stops.is_empty() {
        return Err(AppError::NotFound(format!(
            "No stop found matching '{}'. Try area names like Westlands, Kasarani, Buru Buru, Karen, Eastleigh, or a specific stop name like Railways, Koja, Ngara.",
            q.from
        )));
    }
    if to_stops.is_empty() {
        return Err(AppError::NotFound(format!(
            "No stop found matching '{}'. Try area names like CBD, Westlands, Karen, Kasarani, Langata, or a specific stop name like Railways, Koja, Ngara.",
            q.to
        )));
    }

    let origin_ids: Vec<i32> = from_stops.iter().map(|s| s.id).collect();
    let dest_ids: Vec<i32> = to_stops.iter().map(|s| s.id).collect();

    let mut plans: Vec<RoutePlan> = Vec::new();

    // ── Phase 1: direct routes ────────────────────────────────────
    let direct = transit_db::find_direct_routes(&state.db, &origin_ids, &dest_ids).await?;
    for dr in &direct {
        let stops_on_route = transit_db::get_stops_on_route(&state.db, dr.route_id).await?;
        let leg_stops: Vec<LegStop> = stops_on_route
            .into_iter()
            .map(|s| LegStop {
                name: s.name,
                lat: s.lat,
                lon: s.lon,
                sequence: s.stop_sequence,
            })
            .collect();

        let est_minutes = (dr.seq_diff * 5).max(5);
        let leg = RouteLeg {
            leg_number: 1,
            route_number: dr.route_number.clone(),
            route_name: dr.route_name.clone(),
            board_at: dr.from_stop_name.clone(),
            board_stage: dr.stage.clone(),
            board_lat: dr.stage_lat,
            board_lon: dr.stage_lon,
            alight_at: dr.to_stop_name.clone(),
            fare_kes: dr.fare_kes,
            est_minutes,
            stops: leg_stops,
        };
        plans.push(RoutePlan {
            summary: format!(
                "Take Route {} ({}) from {} to {}",
                dr.route_number, dr.route_name, dr.from_stop_name, dr.to_stop_name
            ),
            total_fare_kes: dr.fare_kes,
            total_minutes: est_minutes,
            transfers: 0,
            legs: vec![leg],
        });
    }

    // ── Phase 2: 1-transfer routes (only if no direct found) ──────
    if plans.is_empty() {
        let transfers =
            transit_db::find_transfer_routes(&state.db, &origin_ids, &dest_ids).await?;
        for tr in &transfers {
            let stops1 = transit_db::get_stops_on_route(&state.db, tr.route1_id).await?;
            let stops2 = transit_db::get_stops_on_route(&state.db, tr.route2_id).await?;

            let leg1_stops: Vec<LegStop> = stops1
                .into_iter()
                .map(|s| LegStop { name: s.name, lat: s.lat, lon: s.lon, sequence: s.stop_sequence })
                .collect();
            let leg2_stops: Vec<LegStop> = stops2
                .into_iter()
                .map(|s| LegStop { name: s.name, lat: s.lat, lon: s.lon, sequence: s.stop_sequence })
                .collect();

            let est1 = (tr.leg1_seq_diff * 5).max(5);
            let est2 = (tr.leg2_seq_diff * 5).max(5);

            let leg1 = RouteLeg {
                leg_number: 1,
                route_number: tr.route1_number.clone(),
                route_name: tr.route1_name.clone(),
                board_at: tr.from_stop_name.clone(),
                board_stage: tr.stage1.clone(),
                board_lat: tr.stage1_lat,
                board_lon: tr.stage1_lon,
                alight_at: tr.transfer_stop_name.clone(),
                fare_kes: tr.fare1_kes,
                est_minutes: est1,
                stops: leg1_stops,
            };
            let leg2 = RouteLeg {
                leg_number: 2,
                route_number: tr.route2_number.clone(),
                route_name: tr.route2_name.clone(),
                board_at: tr.transfer_stop_name.clone(),
                board_stage: tr.stage2.clone(),
                board_lat: tr.stage2_lat,
                board_lon: tr.stage2_lon,
                alight_at: tr.to_stop_name.clone(),
                fare_kes: tr.fare2_kes,
                est_minutes: est2,
                stops: leg2_stops,
            };

            plans.push(RoutePlan {
                summary: format!(
                    "Take Route {} from {} to {} (transfer), then Route {} to {}",
                    tr.route1_number,
                    tr.from_stop_name,
                    tr.transfer_stop_name,
                    tr.route2_number,
                    tr.to_stop_name,
                ),
                total_fare_kes: tr.fare1_kes + tr.fare2_kes,
                total_minutes: est1 + est2 + 5, // +5 min transfer time
                transfers: 1,
                legs: vec![leg1, leg2],
            });
        }
    }

    if plans.is_empty() {
        return Ok(Json(serde_json::json!({
            "plans": [],
            "message": format!(
                "No direct route found from '{}' to '{}'. Try alternative spelling or nearby landmarks.",
                q.from, q.to
            )
        })));
    }

    // Sort: direct routes first, then by total fare
    plans.sort_by(|a, b| a.transfers.cmp(&b.transfers).then(a.total_fare_kes.cmp(&b.total_fare_kes)));

    Ok(Json(serde_json::json!({
        "from": q.from,
        "to": q.to,
        "plans": plans,
    })))
}

// ── Stage Finder ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StageQuery {
    pub destination: String,
}

/// GET /api/transit/stages/find?destination=Rongai
pub async fn find_stage(
    State(state): State<AppState>,
    Query(q): Query<StageQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let routes =
        transit_db::find_routes_to_destination(&state.db, &q.destination).await?;

    if routes.is_empty() {
        return Err(AppError::NotFound(format!(
            "No route found for '{}'. Try a different spelling.",
            q.destination
        )));
    }

    let result: Vec<serde_json::Value> = routes
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "route_number": r.route_number,
                "route_name": r.route_name,
                "board_at": r.stage,
                "board_lat": r.stage_lat,
                "board_lon": r.stage_lon,
                "fare_min": r.typical_fare_min,
                "fare_max": r.typical_fare_max,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "destination": q.destination,
        "routes": result,
    })))
}

// ── Live Vehicles ─────────────────────────────────────────────────────────────

/// GET /api/transit/vehicles/live
pub async fn live_vehicles(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicles = transit_db::get_live_vehicle_locations(&state.db).await?;
    Ok(Json(serde_json::json!({ "vehicles": vehicles })))
}

// ── Journey Tracker ───────────────────────────────────────────────────────────

/// GET /api/journey/:payment_id — retrieve journey status for a passenger.
pub async fn get_journey(
    State(state): State<AppState>,
    Path(payment_id): Path<Uuid>,
) -> Result<Json<JourneyInfo>, AppError> {
    let raw = transit_db::get_journey_raw(&state.db, payment_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Payment not found".into()))?;

    // Try to find stops on the matching transit route (text match)
    let route_stops = transit_db::find_stops_by_text(&state.db, &raw.destination)
        .await
        .unwrap_or_default();

    // Build simple route polyline from destination stop lookup
    let leg_stops = route_stops
        .into_iter()
        .map(|s| LegStop {
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            sequence: 0,
        })
        .collect();

    let status = match raw.payment_status.as_str() {
        "confirmed" => "tracking",
        "pending"   => "payment_pending",
        _           => "arrived",
    };

    Ok(Json(JourneyInfo {
        payment_id,
        route: raw.route,
        destination: raw.destination,
        fare_kes: raw.fare_kes,
        vehicle_lat: raw.vehicle_lat,
        vehicle_lon: raw.vehicle_lon,
        vehicle_updated_seconds_ago: raw.updated_seconds_ago,
        route_stops: leg_stops,
        status: status.to_string(),
    }))
}

// ── Crowdsource Reports ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ReportPayload {
    pub report_type: String,
    pub route_id: Option<i32>,
    pub stop_id: Option<i32>,
    pub description: String,
    pub reporter_phone: Option<String>,
}

#[derive(Serialize)]
pub struct ReportResponse {
    pub success: bool,
    pub message: String,
}

/// POST /api/transit/report
pub async fn submit_report(
    State(state): State<AppState>,
    Json(payload): Json<ReportPayload>,
) -> Result<Json<ReportResponse>, AppError> {
    let valid_types = ["route_change", "stage_change", "congestion", "flooding", "police_check", "other"];
    if !valid_types.contains(&payload.report_type.as_str()) {
        return Err(AppError::BadRequest(
            "report_type must be one of: route_change, stage_change, congestion, flooding, police_check, other".into(),
        ));
    }
    if payload.description.trim().is_empty() || payload.description.len() > 500 {
        return Err(AppError::BadRequest("description required (max 500 chars)".into()));
    }

    transit_db::insert_route_report(
        &state.db,
        &payload.report_type,
        payload.route_id,
        payload.stop_id,
        &payload.description,
        payload.reporter_phone.as_deref(),
    )
    .await?;

    Ok(Json(ReportResponse {
        success: true,
        message: "Report submitted. Thank you for helping keep Nairobi moving!".into(),
    }))
}

/// GET /api/transit/reports
pub async fn list_reports(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let reports: Vec<RouteReport> = transit_db::get_active_reports(&state.db).await?;
    Ok(Json(serde_json::json!({ "reports": reports })))
}
