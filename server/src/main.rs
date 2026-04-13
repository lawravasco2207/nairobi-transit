mod cache;
mod config;
mod db;
mod domain;
mod error;
mod handlers;
mod services;

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

/// Shared application state injected into every handler via Axum's State extractor.
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub cache: Arc<cache::session::Cache>,
    pub config: config::Config,
    pub ws_tx: broadcast::Sender<String>, // payment events → conductor WS
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env — try CWD first, fall back to server/.env when invoked
    // from the workspace root (e.g. `cargo run --manifest-path server/Cargo.toml`).
    dotenvy::dotenv().ok();
    if std::env::var("DATABASE_URL").is_err() {
        let _ = dotenvy::from_path("server/.env");
    }
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = config::Config::from_env();

    // ── Postgres connection pool ────────────────────────────────────
    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;

    // Run SQL migrations on startup so the schema is always up-to-date
    run_migrations(&db).await?;

    // ── Redis cache ─────────────────────────────────────────────────
    let cache = Arc::new(cache::session::Cache::new(&config.redis_url)?);

    // ── Broadcast channel for conductor WebSocket updates ───────────
    let (ws_tx, _) = broadcast::channel::<String>(256);

    let state = AppState {
        db,
        cache,
        config: config.clone(),
        ws_tx,
    };

    // ── Routes ──────────────────────────────────────────────────────
    let app = Router::new()
        // Passenger routes
        .route("/api/pay/qr", post(handlers::stk::initiate_stk_payment))
        .route("/api/ussd", post(handlers::ussd::handle_ussd))
        // Daraja webhook
        .route(
            "/api/daraja/callback",
            post(handlers::webhook::daraja_callback),
        )
        // Conductor routes
        .route(
            "/api/conductor/trip",
            post(handlers::conductor::update_trip),
        )
        .route(
            "/api/qr/:vehicle_short_id",
            get(handlers::qr::get_qr),
        )
        .route("/api/conductor/ws", get(handlers::ws::conductor_ws))
        // Conductor GPS location ping
        .route("/api/conductor/location", post(handlers::gps::update_location))
        // Registration routes
        .route("/api/vehicles/register", post(handlers::registration::register_vehicle))
        .route("/api/conductors/register", post(handlers::registration::register_conductor))
        // Passenger pay page (QR code destination)
        .route("/pay/:vehicle_short_id", get(handlers::pay_page::pay_page))
        // Transit / GIS routes
        .route("/api/transit/stops/nearby",  get(handlers::transit::nearby_stops))
        .route("/api/transit/stops/search",  get(handlers::transit::search_stops))
        .route("/api/transit/route",        get(handlers::transit::plan_route))
        .route("/api/transit/stages/find",  get(handlers::transit::find_stage))
        .route("/api/transit/vehicles/live",get(handlers::transit::live_vehicles))
        .route("/api/transit/report",       post(handlers::transit::submit_report))
        .route("/api/transit/reports",      get(handlers::transit::list_reports))
        // Passenger journey tracker
        .route("/api/journey/:payment_id",  get(handlers::transit::get_journey))
        // Settings / env status
        .route("/api/settings", get(handlers::settings::get_settings))
        // Health check
        .route("/health", get(|| async { "ok" }))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("Nairobi Transit server running on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Run SQL migration files from ./migrations in alphabetical order.
/// Each file is executed inside a transaction for atomicity.
async fn run_migrations(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    // Ensure the migrations tracking table exists
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    // Locate the migrations directory — works wherever cargo invokes the binary.
    let migrations_dir = ["./migrations", "server/migrations"]
        .iter()
        .find(|p| std::path::Path::new(p).is_dir())
        .copied()
        .ok_or_else(|| anyhow::anyhow!("Could not find migrations directory"))?;

    let mut entries: Vec<_> = std::fs::read_dir(migrations_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "sql")
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip if already applied
        let applied: Option<(String,)> =
            sqlx::query_as("SELECT name FROM _migrations WHERE name = $1")
                .bind(&name)
                .fetch_optional(pool)
                .await?;

        if applied.is_some() {
            continue;
        }

        let sql = std::fs::read_to_string(entry.path())?;
        tracing::info!("Running migration: {}", name);
        sqlx::raw_sql(&sql).execute(pool).await?;

        sqlx::query("INSERT INTO _migrations (name) VALUES ($1)")
            .bind(&name)
            .execute(pool)
            .await?;
    }

    tracing::info!("All migrations applied");
    Ok(())
}
