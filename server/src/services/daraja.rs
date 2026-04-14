use anyhow::Result;
use base64::{engine::general_purpose, Engine};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config::Config;

/// Service for interacting with Safaricom's Daraja 3.0 API.
/// Handles OAuth token acquisition and STK Push initiation.
pub struct DarajaService {
    client: Client,
    config: Config,
}

#[derive(Serialize)]
struct StkPushPayload {
    #[serde(rename = "BusinessShortCode")]
    business_short_code: String,
    #[serde(rename = "Password")]
    password: String,
    #[serde(rename = "Timestamp")]
    timestamp: String,
    #[serde(rename = "TransactionType")]
    transaction_type: String,
    #[serde(rename = "Amount")]
    amount: i32,
    #[serde(rename = "PartyA")]
    party_a: String,
    #[serde(rename = "PartyB")]
    party_b: String,
    #[serde(rename = "PhoneNumber")]
    phone_number: String,
    #[serde(rename = "CallBackURL")]
    callback_url: String,
    #[serde(rename = "AccountReference")]
    account_reference: String,
    #[serde(rename = "TransactionDesc")]
    transaction_desc: String,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct StkPushResponse {
    #[serde(rename = "CheckoutRequestID")]
    pub checkout_request_id: String,
    #[serde(rename = "ResponseCode")]
    pub response_code: String,
    #[serde(rename = "ResponseDescription")]
    pub response_description: String,
}

/// Daraja returns this shape when the request itself is rejected
/// (bad credentials, invalid phone, duplicate request, etc.)
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct DarajaErrorResponse {
    #[serde(alias = "requestId", alias = "RequestID")]
    request_id: Option<String>,
    #[serde(alias = "errorCode", alias = "ErrorCode")]
    error_code: Option<String>,
    #[serde(alias = "errorMessage", alias = "ErrorMessage")]
    error_message: Option<String>,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: String,
}

impl DarajaService {
    pub fn new(config: &Config) -> Self {
        Self {
            client: Client::new(),
            config: config.clone(),
        }
    }

    /// Fetch a short-lived OAuth access token from Daraja.
    async fn get_access_token(&self) -> Result<String> {
        let credentials = general_purpose::STANDARD.encode(format!(
            "{}:{}",
            self.config.daraja_consumer_key, self.config.daraja_consumer_secret
        ));

        let resp: AccessTokenResponse = self
            .client
            .get(format!(
                "{}/oauth/v1/generate?grant_type=client_credentials",
                self.config.daraja_base_url
            ))
            .header("Authorization", format!("Basic {}", credentials))
            .send()
            .await?
            .json()
            .await?;

        Ok(resp.access_token)
    }

    /// Generate the Lipa Na M-Pesa password: base64(shortcode + passkey + timestamp).
    fn generate_password(&self, timestamp: &str) -> String {
        let raw = format!(
            "{}{}{}",
            self.config.daraja_shortcode, self.config.daraja_passkey, timestamp
        );
        general_purpose::STANDARD.encode(raw.as_bytes())
    }

    /// Initiate an STK Push to the passenger's phone.
    /// In sandbox mode, returns a simulated success immediately so demo
    /// users aren't left waiting for a prompt that never arrives on their
    /// real handset.
    pub async fn stk_push(
        &self,
        phone: &str,       // "254712345678"
        amount_kes: i32,
        paybill: &str,
        description: &str,
        account_ref: &str,
    ) -> Result<StkPushResponse> {
        if self.config.is_sandbox() {
            let fake_id = format!("ws_CO_DEMO_{}", Utc::now().format("%Y%m%d%H%M%S"));
            tracing::info!(phone = %phone, amount = amount_kes, "Sandbox mode: simulating STK push (no real prompt sent)");
            return Ok(StkPushResponse {
                checkout_request_id: fake_id,
                response_code: "0".to_string(),
                response_description: "Sandbox: simulated success".to_string(),
            });
        }

        let token = self.get_access_token().await?;
        let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
        let password = self.generate_password(&timestamp);

        // Daraja limits AccountReference to 12 chars and TransactionDesc to 13 chars
        let safe_ref = &account_ref[..std::cmp::min(12, account_ref.len())];
        let safe_desc = &description[..std::cmp::min(13, description.len())];

        let payload = StkPushPayload {
            business_short_code: self.config.daraja_shortcode.clone(),
            password,
            timestamp,
            transaction_type: "CustomerPayBillOnline".to_string(),
            amount: amount_kes,
            party_a: phone.to_string(),
            party_b: paybill.to_string(),
            phone_number: phone.to_string(),
            callback_url: self.config.daraja_callback_url.clone(),
            account_reference: safe_ref.to_string(),
            transaction_desc: safe_desc.to_string(),
        };

        let resp = self
            .client
            .post(format!(
                "{}/mpesa/stkpush/v1/processrequest",
                self.config.daraja_base_url
            ))
            .header("Authorization", format!("Bearer {}", token))
            .json(&payload)
            .send()
            .await?;

        let status = resp.status();
        let body = resp.text().await?;

        tracing::debug!(status = %status, body = %body, "Daraja STK Push response");

        // Try to parse as success first
        if let Ok(success) = serde_json::from_str::<StkPushResponse>(&body) {
            return Ok(success);
        }

        // Otherwise parse as error
        if let Ok(err) = serde_json::from_str::<DarajaErrorResponse>(&body) {
            let msg = err.error_message.unwrap_or_else(|| "Unknown Daraja error".into());
            anyhow::bail!("Daraja rejected request: {}", msg);
        }

        anyhow::bail!("Unexpected Daraja response (HTTP {}): {}", status, body);
    }
}
