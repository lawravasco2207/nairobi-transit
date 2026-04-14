/// Centralised application configuration loaded from environment variables.
/// All secrets live in .env — never hardcoded.
#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub redis_url: String,
    pub daraja_base_url: String,
    pub daraja_consumer_key: String,
    pub daraja_consumer_secret: String,
    pub daraja_passkey: String,
    pub daraja_shortcode: String,
    pub daraja_callback_url: String,
    pub at_username: String,
    pub at_api_key: String,
    pub at_sender_id: String,
    pub jwt_secret: String,
    pub qr_base_url: String,
}

impl Config {
    /// Build config from environment. Panics on missing required vars so the
    /// app fails fast at startup rather than mid-request.
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()
                .unwrap_or(8080),
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL required"),
            redis_url: std::env::var("REDIS_URL").expect("REDIS_URL required"),
            daraja_base_url: std::env::var("DARAJA_BASE_URL").expect("DARAJA_BASE_URL required"),
            daraja_consumer_key: std::env::var("DARAJA_CONSUMER_KEY")
                .expect("DARAJA_CONSUMER_KEY required"),
            daraja_consumer_secret: std::env::var("DARAJA_CONSUMER_SECRET")
                .expect("DARAJA_CONSUMER_SECRET required"),
            daraja_passkey: std::env::var("DARAJA_PASSKEY").expect("DARAJA_PASSKEY required"),
            daraja_shortcode: std::env::var("DARAJA_SHORTCODE")
                .expect("DARAJA_SHORTCODE required"),
            daraja_callback_url: std::env::var("DARAJA_CALLBACK_URL")
                .expect("DARAJA_CALLBACK_URL required"),
            at_username: std::env::var("AT_USERNAME").expect("AT_USERNAME required"),
            at_api_key: std::env::var("AT_API_KEY").expect("AT_API_KEY required"),
            at_sender_id: std::env::var("AT_SENDER_ID").unwrap_or_else(|_| "TRANSIT".into()),
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET required"),
            qr_base_url: std::env::var("QR_BASE_URL").expect("QR_BASE_URL required"),
        }
    }

    /// True when running against Safaricom's sandbox (not production).
    pub fn is_sandbox(&self) -> bool {
        self.daraja_base_url.contains("sandbox")
    }
}
