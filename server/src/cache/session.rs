use anyhow::Result;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// USSD session state stored in Redis between menu steps.
/// Survives across the stateless HTTP POSTs that Africa's Talking sends.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UssdSession {
    pub trip_id: Uuid,
    pub vehicle_short_id: String,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,
    pub paybill_no: String,
    pub passenger_phone: String,
}

/// Thin wrapper around a Redis client for session management.
pub struct Cache {
    pub client: redis::Client,
}

impl Cache {
    pub fn new(redis_url: &str) -> Result<Self> {
        Ok(Self {
            client: redis::Client::open(redis_url)?,
        })
    }

    /// Persist USSD session for 60 seconds (well beyond the 30s USSD timeout).
    pub async fn save_ussd_session(&self, session_id: &str, session: &UssdSession) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ussd:{}", session_id);
        let value = serde_json::to_string(session)?;
        conn.set_ex::<_, _, ()>(&key, &value, 60).await?;
        Ok(())
    }

    /// Retrieve USSD session (returns None if expired or missing).
    pub async fn get_ussd_session(&self, session_id: &str) -> Result<Option<UssdSession>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ussd:{}", session_id);
        let value: Option<String> = conn.get(&key).await?;
        Ok(value.and_then(|v| serde_json::from_str(&v).ok()))
    }

    /// Delete USSD session after the flow completes or is cancelled.
    pub async fn delete_ussd_session(&self, session_id: &str) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ussd:{}", session_id);
        conn.del::<_, ()>(&key).await?;
        Ok(())
    }

    /// Check if Redis is reachable.
    pub async fn ping(&self) -> Result<bool> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let pong: String = redis::cmd("PING").query_async(&mut conn).await?;
        Ok(pong == "PONG")
    }
}
