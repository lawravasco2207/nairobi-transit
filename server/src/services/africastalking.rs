use anyhow::Result;
use reqwest::Client;

use crate::config::Config;

/// Service for sending SMS via Africa's Talking API.
/// Primarily used to send payment receipts to feature-phone passengers.
pub struct ATService {
    client: Client,
    config: Config,
}

impl ATService {
    pub fn new(config: &Config) -> Self {
        Self {
            client: Client::new(),
            config: config.clone(),
        }
    }

    /// Send an SMS to a Kenyan phone number.
    /// Phone should be in "254…" format; we prefix "+" for AT.
    pub async fn send_sms(&self, phone: &str, message: &str) -> Result<()> {
        let phone_fmt = if phone.starts_with("254") {
            format!("+{}", phone)
        } else {
            phone.to_string()
        };

        self.client
            .post("https://api.africastalking.com/version1/messaging")
            .header("apiKey", &self.config.at_api_key)
            .header("Accept", "application/json")
            .form(&[
                ("username", self.config.at_username.as_str()),
                ("to", phone_fmt.as_str()),
                ("message", message),
                ("from", self.config.at_sender_id.as_str()),
            ])
            .send()
            .await?;

        Ok(())
    }
}
