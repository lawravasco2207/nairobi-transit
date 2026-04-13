use axum::{extract::State, Json};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub struct ServerInfo {
    pub host: String,
    pub port: u16,
}

#[derive(Serialize)]
pub struct EnvStatus {
    pub server: ServerInfo,
    pub database_connected: bool,
    pub redis_connected: bool,
    pub daraja_configured: bool,
    pub daraja_base_url: String,
    pub at_configured: bool,
    pub at_username: String,
    pub qr_base_url: String,
    pub callback_url: String,
}

pub async fn get_settings(State(state): State<AppState>) -> Json<EnvStatus> {
    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();

    let redis_ok = state
        .cache
        .ping()
        .await
        .unwrap_or(false);

    let cfg = &state.config;

    Json(EnvStatus {
        server: ServerInfo {
            host: cfg.host.clone(),
            port: cfg.port,
        },
        database_connected: db_ok,
        redis_connected: redis_ok,
        daraja_configured: !cfg.daraja_consumer_key.is_empty(),
        daraja_base_url: cfg.daraja_base_url.clone(),
        at_configured: !cfg.at_api_key.is_empty(),
        at_username: cfg.at_username.clone(),
        qr_base_url: cfg.qr_base_url.clone(),
        callback_url: cfg.daraja_callback_url.clone(),
    })
}
