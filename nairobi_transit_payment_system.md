# Nairobi Transit Payment System — Implementation Guide

> **Stack:** Rust · Axum · PostgreSQL 18.3 (DigitalOcean) · Azure Redis · Daraja 3.0 (M-Pesa) · Africa's Talking (USSD + SMS) · Next.js 15  
> **Solves:** Fare payment via phone (smartphone + feature phone), real-time route/fare broadcasting, zero conductor-passenger disputes

> **Current status:** This document describes the system architecture and implementation decisions. For quick-start instructions, environment variables, and deployment, see the main [README.md](README.md). For the full feature documentation including GIS data provenance and known limitations, see [docs/index.md](docs/index.md).

> **GIS Integration:** Migrations 005–007 added 4,284 transit stops, 136 routes, and fuzzy stop search from the [Digital Matatus](http://www.digitalmatatus.com) GTFS dataset (MIT Civic Data Design Lab + University of Nairobi, 2019 snapshot). The shapefile-to-SQL converter is in `scripts/generate_gis_sql.py`.

> **Deployment:** Runs on DigitalOcean App Platform (auto-deploy on push to `main`, configured in `.do/app.yaml`). No Azure Container Apps, no GitHub Actions CI/CD.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [Database Schema](#4-database-schema)
5. [Environment Setup](#5-environment-setup)
6. [Cargo.toml](#6-cargotoml)
7. [Core Domain Types](#7-core-domain-types)
8. [Database Layer](#8-database-layer)
9. [Conductor Trip API](#9-conductor-trip-api)
10. [QR Code Generation](#10-qr-code-generation)
11. [STK Push Handler (Smartphone)](#11-stk-push-handler-smartphone)
12. [USSD Handler (Feature Phone)](#12-ussd-handler-feature-phone)
13. [Daraja Integration](#13-daraja-integration)
14. [Africa's Talking Integration](#14-africas-talking-integration)
15. [Daraja Webhook Receiver](#15-daraja-webhook-receiver)
16. [Conductor WebSocket Feed](#16-conductor-websocket-feed)
17. [Redis Session Cache](#17-redis-session-cache)
18. [Main Server Entry Point](#18-main-server-entry-point)
19. [Docker Setup](#19-docker-setup)
20. [Running the System](#20-running-the-system)
21. [API Reference](#21-api-reference)
22. [End-to-End Flow Summary](#22-end-to-end-flow-summary)

---

## 1. System Overview

### The Problem We're Solving

| Pain Point | Our Fix |
|---|---|
| Passenger doesn't know fare | Conductor sets fare on trip start — system shows it before payment |
| Passenger doesn't know route/destination | Conductor sets route + destination — encoded in QR and USSD prompt |
| Delayed M-Pesa SMS = dispute | Confirmation goes to conductor display directly via webhook, not SMS |
| Wrong number sent | No number typed — QR or `*384*[vehicle]#` does it automatically |
| Feature phone users excluded | USSD flow works on any GSM phone, no internet |
| Conductor has Fuliza debt | Money goes to SACCO Paybill, never a personal line |
| Reversal abuse | C2B Paybill — reversal requires formal process, not a call |

### Two Payment Channels, One Backend

```
Smartphone  →  Scan QR  →  STK Push  →  Tap approve  →  ✓
Feature phone  →  Dial *384*[ID]#  →  Confirm on screen  →  PIN  →  ✓
                          ↓
                  Rust Payment Core
                          ↓
               Daraja 3.0 / Africa's Talking
                          ↓
               Conductor display updates live
```

---

## 2. Architecture

### Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        PASSENGER LAYER                          │
│                                                                 │
│   [Smartphone]              [Feature Phone / Kabambe]           │
│   Scan QR sticker           Dial *384*{vehicle_id}#             │
│   on seat/door              (no internet, any network)          │
└──────────┬──────────────────────────┬───────────────────────────┘
           │ HTTPS                    │ USSD (GSM)
           ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RUST API SERVER (Axum)                      │
│                                                                 │
│  POST /api/pay/qr        ← QR scan initiates STK push           │
│  POST /api/ussd          ← Africa's Talking USSD gateway        │
│  POST /api/daraja/callback ← M-Pesa payment confirmation        │
│  POST /api/conductor/trip  ← Conductor sets route/fare/dest     │
│  GET  /api/conductor/ws    ← WebSocket: live payment feed       │
│  GET  /api/qr/{vehicle_id} ← Generate/refresh QR code          │
└──────────┬───────────────────────────────┬──────────────────────┘
           │                               │
    ┌──────▼──────┐                 ┌──────▼──────┐
    │  PostgreSQL  │                 │    Redis     │
    │  (persist)   │                 │  (sessions,  │
    │              │                 │   USSD state,│
    │  trips       │                 │   idempotency│
    │  payments    │                 │   keys)      │
    │  vehicles    │                 └─────────────┘
    │  conductors  │
    └──────────────┘
           │
    ┌──────▼──────────────────────────┐
    │         EXTERNAL APIs            │
    │                                  │
    │  Safaricom Daraja 3.0            │
    │  ├─ STK Push (C2B prompt)        │
    │  ├─ C2B Paybill (receive money)  │
    │  └─ B2C (refunds if needed)      │
    │                                  │
    │  Africa's Talking                │
    │  ├─ USSD gateway (feature phone) │
    │  └─ SMS (receipts + fallback)    │
    └──────────────────────────────────┘
```

### Key Design Decisions

**Why Rust + Axum?** Sub-millisecond response on USSD sessions which hard-timeout in 20–30 seconds. No GC pauses. Fearless async concurrency via Tokio.

**Why C2B Paybill instead of send-money?** Reversals on Paybill require formal dispute resolution — eliminates the "cancel at Hakikisha" abuse that made matatus ban M-Pesa.

**Why Africa's Talking for USSD?** They're a multi-network aggregator — Safaricom, Airtel, and Telkom users all hit the same endpoint. One integration covers all networks.

**Why Redis for USSD state?** USSD is stateless at the network level — each menu step is a new HTTP POST to your server. Redis stores the session state (which vehicle, which step, passenger phone) between those POSTs within the 30-second window.

---

## 3. Project Structure

> **Note:** The structure below shows the original single-package Rust backend. The current repository also includes a `frontend/` (Next.js 15), `GIS_DATA_2019/` (Digital Matatus shapefiles), `scripts/` (shapefile-to-SQL converter), and `docs/` (technical docs). Migrations 005–007 were added for GIS data.

```
nairobi-transit/
├── server/
│   ├── Cargo.toml
│   ├── Dockerfile
│   ├── migrations/
│   │   ├── 001_create_vehicles.sql
│   │   ├── 002_create_conductors.sql
│   │   ├── 003_create_trips.sql
│   │   ├── 004_create_payments.sql
│   │   ├── 005_create_transit_stops.sql    # GIS tables
│   │   ├── 006_seed_gis_data.sql           # 4,284 stops, 136 routes
│   │   └── 007_stop_aliases.sql            # fuzzy search (pg_trgm)
│   └── src/
│       ├── main.rs
│       ├── config.rs
│       ├── error.rs
│       ├── domain/
│       ├── db/
│       ├── handlers/
│       │   ├── conductor.rs
│       │   ├── qr.rs
│       │   ├── stk.rs
│       │   ├── ussd.rs
│       │   ├── webhook.rs
│       │   ├── ws.rs
│       │   ├── pay_page.rs
│       │   ├── registration.rs
│       │   └── settings.rs
│       ├── services/
│       └── cache/
├── frontend/                   # Next.js 15 / React 19 / Tailwind v4
├── GIS_DATA_2019/              # Digital Matatus shapefiles
├── scripts/generate_gis_sql.py # Converts shapefiles → SQL
├── docs/index.md               # Full technical documentation
└── .do/app.yaml                # DigitalOcean App Platform spec
```

---

## 4. Database Schema

### `migrations/001_create_vehicles.sql`

```sql
CREATE TABLE vehicles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate       VARCHAR(20) UNIQUE NOT NULL,
    short_id    VARCHAR(10) UNIQUE NOT NULL, -- e.g. "NCH23" used in USSD *384*NCH23#
    sacco_name  VARCHAR(100) NOT NULL,
    paybill_no  VARCHAR(20) NOT NULL,        -- SACCO's registered Daraja Paybill
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast USSD lookup by short_id
CREATE INDEX idx_vehicles_short_id ON vehicles(short_id);
```

### `migrations/002_create_conductors.sql`

```sql
CREATE TABLE conductors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       VARCHAR(15) UNIQUE NOT NULL,  -- +254...
    name        VARCHAR(100) NOT NULL,
    vehicle_id  UUID REFERENCES vehicles(id),
    pin_hash    VARCHAR(255) NOT NULL,         -- bcrypt hash of conductor PIN
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `migrations/003_create_trips.sql`

```sql
CREATE TABLE trips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
    conductor_id    UUID NOT NULL REFERENCES conductors(id),
    route           VARCHAR(100) NOT NULL,      -- e.g. "CBD → Kasarani"
    destination     VARCHAR(100) NOT NULL,      -- e.g. "Kasarani Stage"
    fare_amount     INTEGER NOT NULL,           -- in KES cents (e.g. 6000 = Ksh 60)
    status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active | ended
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ
);

-- Only one active trip per vehicle at a time
CREATE UNIQUE INDEX idx_one_active_trip
    ON trips(vehicle_id)
    WHERE status = 'active';

CREATE INDEX idx_trips_vehicle ON trips(vehicle_id);
```

### `migrations/004_create_payments.sql`

```sql
CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id             UUID NOT NULL REFERENCES trips(id),
    passenger_phone     VARCHAR(15) NOT NULL,
    amount              INTEGER NOT NULL,            -- KES cents
    channel             VARCHAR(20) NOT NULL,        -- 'stk' | 'ussd'
    status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | confirmed | failed
    mpesa_ref           VARCHAR(50),                 -- M-Pesa transaction code
    checkout_request_id VARCHAR(100),                -- Daraja STK checkout ID
    idempotency_key     VARCHAR(100) UNIQUE NOT NULL, -- prevents double-charge
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at        TIMESTAMPTZ
);

CREATE INDEX idx_payments_trip ON payments(trip_id);
CREATE INDEX idx_payments_checkout ON payments(checkout_request_id);
CREATE INDEX idx_payments_phone ON payments(passenger_phone);
```

---

## 5. Environment Setup

> See `server/.env.example` for the current template. Copy it to `server/.env` for local development.

### Local development `.env`

```env
# Server
HOST=0.0.0.0
PORT=8080
RUST_LOG=info

# Database (local dev)
DATABASE_URL=postgres://transit:transit@localhost:5432/nairobi_transit
# Production (DigitalOcean managed PostgreSQL):
# DATABASE_URL=postgres://doadmin:<password>@<host>.k.db.ondigitalocean.com:25060/transitdb?sslmode=require

# Redis (local dev)
REDIS_URL=redis://localhost:6379
# Production (Azure Cache for Redis):
# REDIS_URL=rediss://:<key>@<name>.southafricanorth.redis.azure.net:10000

# Daraja (M-Pesa) — use sandbox for development
DARAJA_BASE_URL=https://sandbox.safaricom.co.ke
# Sandbox test shortcode: 174379
# Sandbox test phone:     254708374149
# Sandbox passkey:        bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
DARAJA_CONSUMER_KEY=your_consumer_key_here
DARAJA_CONSUMER_SECRET=your_consumer_secret_here
DARAJA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
DARAJA_SHORTCODE=174379
DARAJA_CALLBACK_URL=https://yourdomain.com/api/daraja/callback

# Africa's Talking
AT_USERNAME=sandbox
AT_API_KEY=your_africastalking_api_key
AT_USSD_CODE=*384#
AT_SENDER_ID=TRANSIT

# JWT secret for conductor auth
JWT_SECRET=your_very_long_random_string_minimum_64_chars

# QR base URL (encoded in QR stickers)
QR_BASE_URL=https://yourdomain.com/pay
```

---

## 6. Cargo.toml

```toml
[package]
name = "nairobi-transit"
version = "0.1.0"
edition = "2021"

[dependencies]
# Web framework
axum = { version = "0.7", features = ["ws", "multipart"] }
tokio = { version = "1", features = ["full"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "trace"] }

# Database
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono"] }

# Redis
redis = { version = "0.25", features = ["tokio-comp", "connection-manager"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# HTTP client (for Daraja + Africa's Talking calls)
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }

# QR code generation
qrcode = "0.14"
image = "0.25"
base64 = "0.22"

# Auth
bcrypt = "0.15"
jsonwebtoken = "9"

# Utilities
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
dotenvy = "0.15"
anyhow = "1"
thiserror = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

---

## 7. Core Domain Types

### `src/domain/trip.rs`

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Trip {
    pub id: Uuid,
    pub vehicle_id: Uuid,
    pub conductor_id: Uuid,
    pub route: String,        // "CBD → Kasarani"
    pub destination: String,  // "Kasarani Stage"
    pub fare_amount: i32,     // KES cents
    pub status: String,       // "active" | "ended"
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

/// What conductor POSTs to start or update a trip
#[derive(Debug, Deserialize)]
pub struct TripUpdateRequest {
    pub route: String,
    pub destination: String,
    pub fare_amount: i32,  // full KES (we convert to cents in handler)
}

/// What we return to QR scanner / USSD prompt
#[derive(Debug, Serialize)]
pub struct TripInfo {
    pub trip_id: Uuid,
    pub vehicle_short_id: String,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,        // human-readable KES
    pub paybill_no: String,
}
```

### `src/domain/payment.rs`

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Payment {
    pub id: Uuid,
    pub trip_id: Uuid,
    pub passenger_phone: String,
    pub amount: i32,
    pub channel: String,         // "stk" | "ussd"
    pub status: String,          // "pending" | "confirmed" | "failed"
    pub mpesa_ref: Option<String>,
    pub checkout_request_id: Option<String>,
    pub idempotency_key: String,
    pub created_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
}

/// Fired to conductor WebSocket on payment confirmation
#[derive(Debug, Serialize, Clone)]
pub struct PaymentConfirmedEvent {
    pub event: String,           // "payment_confirmed"
    pub passenger_phone: String,
    pub amount_kes: i32,
    pub mpesa_ref: String,
    pub channel: String,
    pub trip_id: Uuid,
}
```

### `src/domain/vehicle.rs`

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Vehicle {
    pub id: Uuid,
    pub plate: String,
    pub short_id: String,     // "NCH23" — used in USSD *384*NCH23#
    pub sacco_name: String,
    pub paybill_no: String,
}
```

---

## 8. Database Layer

### `src/db/trips.rs`

```rust
use sqlx::PgPool;
use uuid::Uuid;
use crate::domain::trip::{Trip, TripInfo};
use anyhow::Result;

/// Get the active trip for a vehicle by its short_id (used in USSD + QR)
pub async fn get_active_trip_by_vehicle_short_id(
    pool: &PgPool,
    short_id: &str,
) -> Result<Option<TripInfo>> {
    let row = sqlx::query!(
        r#"
        SELECT t.id, t.route, t.destination, t.fare_amount,
               v.short_id, v.paybill_no
        FROM trips t
        JOIN vehicles v ON v.id = t.vehicle_id
        WHERE v.short_id = $1 AND t.status = 'active'
        LIMIT 1
        "#,
        short_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| TripInfo {
        trip_id: r.id,
        vehicle_short_id: r.short_id,
        route: r.route,
        destination: r.destination,
        fare_kes: r.fare_amount / 100,
        paybill_no: r.paybill_no,
    }))
}

/// Upsert a trip — if active trip exists for vehicle, update it; else create new
pub async fn upsert_trip(
    pool: &PgPool,
    vehicle_id: Uuid,
    conductor_id: Uuid,
    route: &str,
    destination: &str,
    fare_cents: i32,
) -> Result<Trip> {
    // End any existing active trip first
    sqlx::query!(
        "UPDATE trips SET status = 'ended', ended_at = NOW()
         WHERE vehicle_id = $1 AND status = 'active'",
        vehicle_id
    )
    .execute(pool)
    .await?;

    // Create fresh trip
    let trip = sqlx::query_as!(
        Trip,
        r#"
        INSERT INTO trips (id, vehicle_id, conductor_id, route, destination, fare_amount)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
        RETURNING *
        "#,
        vehicle_id, conductor_id, route, destination, fare_cents
    )
    .fetch_one(pool)
    .await?;

    Ok(trip)
}
```

### `src/db/payments.rs`

```rust
use sqlx::PgPool;
use uuid::Uuid;
use crate::domain::payment::Payment;
use anyhow::Result;

pub async fn create_pending_payment(
    pool: &PgPool,
    trip_id: Uuid,
    passenger_phone: &str,
    amount_cents: i32,
    channel: &str,
    checkout_request_id: Option<&str>,
    idempotency_key: &str,
) -> Result<Payment> {
    let payment = sqlx::query_as!(
        Payment,
        r#"
        INSERT INTO payments
            (id, trip_id, passenger_phone, amount, channel,
             checkout_request_id, idempotency_key)
        VALUES
            (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
        RETURNING *
        "#,
        trip_id,
        passenger_phone,
        amount_cents,
        channel,
        checkout_request_id,
        idempotency_key,
    )
    .fetch_one(pool)
    .await?;

    Ok(payment)
}

/// Called when Daraja webhook confirms payment
pub async fn confirm_payment(
    pool: &PgPool,
    checkout_request_id: &str,
    mpesa_ref: &str,
) -> Result<Option<Payment>> {
    let payment = sqlx::query_as!(
        Payment,
        r#"
        UPDATE payments
        SET status = 'confirmed',
            mpesa_ref = $1,
            confirmed_at = NOW()
        WHERE checkout_request_id = $2
          AND status = 'pending'
        RETURNING *
        "#,
        mpesa_ref,
        checkout_request_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(payment)
}
```

---

## 9. Conductor Trip API

### `src/handlers/conductor.rs`

The conductor opens their app (or a simple web page) and sets the route, destination, and fare for each trip. This is the single action that makes everything else work — passengers will see this info before they pay.

```rust
use axum::{extract::{State, Path}, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{
    AppState,
    db::trips::upsert_trip,
    domain::trip::TripUpdateRequest,
    error::AppError,
};

#[derive(Deserialize)]
pub struct ConductorAuth {
    pub conductor_id: Uuid,
    pub vehicle_id: Uuid,
}

#[derive(Deserialize)]
pub struct UpdateTripPayload {
    pub auth: ConductorAuth,
    pub trip: TripUpdateRequest,
}

#[derive(Serialize)]
pub struct UpdateTripResponse {
    pub success: bool,
    pub trip_id: Uuid,
    pub ussd_code: String,  // e.g. "*384*NCH23#" — print this on the seat sticker
    pub qr_url: String,     // passengers with smartphones scan this
    pub message: String,
}

pub async fn update_trip(
    State(state): State<AppState>,
    Json(payload): Json<UpdateTripPayload>,
) -> Result<Json<UpdateTripResponse>, AppError> {
    // Validate conductor owns this vehicle
    // (In production: extract from JWT token instead)
    let fare_cents = payload.trip.fare_amount * 100;

    let trip = upsert_trip(
        &state.db,
        payload.auth.vehicle_id,
        payload.auth.conductor_id,
        &payload.trip.route,
        &payload.trip.destination,
        fare_cents,
    )
    .await?;

    // Get vehicle short_id for the USSD code
    let vehicle = sqlx::query!(
        "SELECT short_id FROM vehicles WHERE id = $1",
        payload.auth.vehicle_id
    )
    .fetch_one(&state.db)
    .await?;

    let ussd_code = format!("*384*{}#", vehicle.short_id);
    let qr_url = format!("{}/pay/{}", state.config.qr_base_url, vehicle.short_id);

    tracing::info!(
        trip_id = %trip.id,
        route = %trip.route,
        destination = %trip.destination,
        fare = payload.trip.fare_amount,
        "Trip updated"
    );

    Ok(Json(UpdateTripResponse {
        success: true,
        trip_id: trip.id,
        ussd_code,
        qr_url,
        message: format!(
            "Trip set: {} → {} at Ksh {}",
            payload.trip.route,
            payload.trip.destination,
            payload.trip.fare_amount
        ),
    }))
}
```

---

## 10. QR Code Generation

### `src/services/qr_generator.rs`

The QR encodes a URL like `https://yourdomain.com/pay/NCH23`. When a smartphone passenger scans it, the browser hits our API which looks up the active trip and initiates STK Push.

```rust
use qrcode::QrCode;
use image::Luma;
use base64::{engine::general_purpose, Engine};
use anyhow::Result;

pub fn generate_qr_base64(vehicle_short_id: &str, base_url: &str) -> Result<String> {
    let url = format!("{}/pay/{}", base_url, vehicle_short_id);
    let code = QrCode::new(url.as_bytes())?;

    let image = code.render::<Luma<u8>>()
        .min_dimensions(200, 200)
        .build();

    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    image.write_to(&mut cursor, image::ImageFormat::Png)?;

    let encoded = general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", encoded))
}
```

### `src/handlers/qr.rs`

```rust
use axum::{extract::{State, Path}, Json};
use serde::Serialize;
use crate::{AppState, error::AppError, services::qr_generator::generate_qr_base64};

#[derive(Serialize)]
pub struct QrResponse {
    pub vehicle_short_id: String,
    pub route: String,
    pub destination: String,
    pub fare_kes: i32,
    pub qr_image_base64: String,  // render as <img src="...">
    pub ussd_fallback: String,
}

/// GET /api/qr/:vehicle_short_id
/// Conductor uses this to display QR on their dashboard/tablet
pub async fn get_qr(
    State(state): State<AppState>,
    Path(vehicle_short_id): Path<String>,
) -> Result<Json<QrResponse>, AppError> {
    let trip = crate::db::trips::get_active_trip_by_vehicle_short_id(
        &state.db,
        &vehicle_short_id,
    )
    .await?
    .ok_or(AppError::NotFound("No active trip for this vehicle".into()))?;

    let qr_image_base64 = generate_qr_base64(
        &vehicle_short_id,
        &state.config.qr_base_url,
    )?;

    Ok(Json(QrResponse {
        vehicle_short_id: vehicle_short_id.clone(),
        route: trip.route,
        destination: trip.destination,
        fare_kes: trip.fare_kes,
        qr_image_base64,
        ussd_fallback: format!("*384*{}#", vehicle_short_id),
    }))
}
```

---

## 11. STK Push Handler (Smartphone)

### `src/handlers/stk.rs`

Passenger scans QR → browser opens pay page → page calls this endpoint with passenger's phone → we fire STK Push to their phone.

```rust
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{
    AppState,
    db::{trips, payments},
    services::daraja::DarajaService,
    error::AppError,
};

#[derive(Deserialize)]
pub struct InitiatePaymentRequest {
    pub vehicle_short_id: String,
    pub passenger_phone: String,  // "0712345678" or "+254712345678"
}

#[derive(Serialize)]
pub struct InitiatePaymentResponse {
    pub success: bool,
    pub message: String,
    pub payment_id: Uuid,
}

/// POST /api/pay/qr
pub async fn initiate_stk_payment(
    State(state): State<AppState>,
    Json(req): Json<InitiatePaymentRequest>,
) -> Result<Json<InitiatePaymentResponse>, AppError> {
    // Normalize phone to 254 format
    let phone = normalize_phone(&req.passenger_phone)?;

    // Look up active trip
    let trip = trips::get_active_trip_by_vehicle_short_id(
        &state.db,
        &req.vehicle_short_id,
    )
    .await?
    .ok_or(AppError::NotFound(
        "No active trip on this vehicle. Ask conductor to set route first.".into()
    ))?;

    // Idempotency key: phone + trip_id + minute window
    // Prevents double-charge if passenger taps twice quickly
    let minute = chrono::Utc::now().format("%Y%m%d%H%M");
    let idempotency_key = format!("{}-{}-{}", phone, trip.trip_id, minute);

    // Check if we already have a pending/confirmed payment with this key
    let existing = sqlx::query!(
        "SELECT id FROM payments WHERE idempotency_key = $1",
        idempotency_key
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(e) = existing {
        return Ok(Json(InitiatePaymentResponse {
            success: true,
            message: "Payment already initiated — check your phone.".into(),
            payment_id: e.id,
        }));
    }

    // Fire STK Push
    let daraja = DarajaService::new(&state.config);
    let stk_resp = daraja.stk_push(
        &phone,
        trip.fare_kes,
        &trip.paybill_no,
        &format!("Fare: {} to {}", trip.route, trip.destination),
        &trip.trip_id.to_string(),
    )
    .await?;

    // Record pending payment
    let payment = payments::create_pending_payment(
        &state.db,
        trip.trip_id,
        &phone,
        trip.fare_kes * 100,
        "stk",
        Some(&stk_resp.checkout_request_id),
        &idempotency_key,
    )
    .await?;

    Ok(Json(InitiatePaymentResponse {
        success: true,
        message: format!(
            "Check your phone — enter M-Pesa PIN to pay Ksh {} for {}",
            trip.fare_kes, trip.destination
        ),
        payment_id: payment.id,
    }))
}

fn normalize_phone(phone: &str) -> Result<String, AppError> {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.len() {
        9 => Ok(format!("254{}", digits)),           // 712345678
        10 if digits.starts_with('0') => Ok(format!("254{}", &digits[1..])), // 0712345678
        12 if digits.starts_with("254") => Ok(digits), // 254712345678
        _ => Err(AppError::BadRequest("Invalid phone number format".into())),
    }
}
```

---

## 12. USSD Handler (Feature Phone)

### `src/handlers/ussd.rs`

Africa's Talking sends a POST to this endpoint on every USSD menu interaction. We maintain state in Redis across the 20–30 second session window.

The flow we design:
```
Passenger dials *384*NCH23#
→ "Route: CBD→Kasarani | Dest: Kasarani Stage | Fare: Ksh 60
   1. Pay now   2. Cancel"
→ Presses 1
→ "Enter your M-Pesa phone number:"
→ Enters 0712345678
→ "Confirm Ksh 60 to Kasarani Stage? 1=Yes 2=No"
→ Presses 1
→ STK Push fires to their number
→ "Done! Enter M-Pesa PIN on your phone. Ref will be SMSed to you."
```

```rust
use axum::{extract::State, Form};
use serde::Deserialize;
use crate::{AppState, cache::session::UssdSession, error::AppError};

/// Africa's Talking sends these fields on every USSD request
#[derive(Deserialize, Debug)]
pub struct UssdRequest {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "phoneNumber")]
    pub phone_number: String,
    #[serde(rename = "networkCode")]
    pub network_code: String,
    #[serde(rename = "serviceCode")]
    pub service_code: String,  // e.g. "*384*NCH23#"
    pub text: String,          // accumulates: "" → "1" → "1*0712345678" → "1*0712345678*1"
}

/// Returns plain text — "CON " prefix = more menus, "END " prefix = session ends
pub async fn handle_ussd(
    State(state): State<AppState>,
    Form(req): Form<UssdRequest>,
) -> String {
    match process_ussd(&state, &req).await {
        Ok(response) => response,
        Err(e) => {
            tracing::error!("USSD error: {:?}", e);
            "END Sorry, service temporarily unavailable. Please try again.".to_string()
        }
    }
}

async fn process_ussd(state: &AppState, req: &UssdRequest) -> Result<String, AppError> {
    // Extract vehicle short_id from service code: "*384*NCH23#" → "NCH23"
    let vehicle_short_id = extract_vehicle_id(&req.service_code)
        .ok_or(AppError::BadRequest("Invalid USSD code".into()))?;

    let steps: Vec<&str> = req.text.split('*').filter(|s| !s.is_empty()).collect();

    // STEP 0: Initial dial — show trip info
    if req.text.is_empty() {
        let trip = crate::db::trips::get_active_trip_by_vehicle_short_id(
            &state.db,
            vehicle_short_id,
        )
        .await?;

        return match trip {
            None => Ok(format!(
                "END This vehicle has no active trip set.\nAsk conductor to update route info."
            )),
            Some(t) => {
                // Cache session with trip info
                let session = UssdSession {
                    trip_id: t.trip_id,
                    vehicle_short_id: vehicle_short_id.to_string(),
                    route: t.route.clone(),
                    destination: t.destination.clone(),
                    fare_kes: t.fare_kes,
                    paybill_no: t.paybill_no.clone(),
                    passenger_phone: String::new(),
                };
                state.cache.save_ussd_session(&req.session_id, &session).await?;

                Ok(format!(
                    "CON Route: {}\nTo: {}\nFare: Ksh {}\n\n1. Pay now\n2. Cancel",
                    t.route, t.destination, t.fare_kes
                ))
            }
        };
    }

    // STEP 1: Pressed 1 (pay) or 2 (cancel)
    if steps.len() == 1 {
        return match steps[0] {
            "1" => Ok("CON Enter your Safaricom number\n(e.g. 0712345678):".to_string()),
            "2" => Ok("END Cancelled. No charge made.".to_string()),
            _ => Ok("END Invalid option. Please try again.".to_string()),
        };
    }

    // STEP 2: Entered phone number
    if steps.len() == 2 && steps[0] == "1" {
        let phone_input = steps[1];
        let session = state.cache.get_ussd_session(&req.session_id).await?
            .ok_or(AppError::NotFound("Session expired".into()))?;

        return Ok(format!(
            "CON Confirm payment:\nKsh {} → {}\nPhone: {}\n\n1. Confirm\n2. Cancel",
            session.fare_kes, session.destination, phone_input
        ));
    }

    // STEP 3: Final confirmation
    if steps.len() == 3 && steps[0] == "1" {
        let phone_input = steps[1];
        let confirmed = steps[2];

        if confirmed != "1" {
            return Ok("END Cancelled. No charge made.".to_string());
        }

        let phone = crate::handlers::stk::normalize_phone_pub(phone_input)
            .map_err(|_| AppError::BadRequest("Invalid phone number".into()))?;

        let session = state.cache.get_ussd_session(&req.session_id).await?
            .ok_or(AppError::NotFound("Session expired. Please dial again.".into()))?;

        // Fire STK Push to passenger's phone
        let daraja = crate::services::daraja::DarajaService::new(&state.config);
        let minute = chrono::Utc::now().format("%Y%m%d%H%M");
        let idempotency_key = format!("{}-{}-{}", phone, session.trip_id, minute);

        let stk_resp = daraja.stk_push(
            &phone,
            session.fare_kes,
            &session.paybill_no,
            &format!("Fare: {} to {}", session.route, session.destination),
            &session.trip_id.to_string(),
        )
        .await?;

        crate::db::payments::create_pending_payment(
            &state.db,
            session.trip_id,
            &phone,
            session.fare_kes * 100,
            "ussd",
            Some(&stk_resp.checkout_request_id),
            &idempotency_key,
        )
        .await?;

        return Ok(format!(
            "END Ksh {} payment initiated.\nEnter M-Pesa PIN on your phone.\nDo NOT close until complete.",
            session.fare_kes
        ));
    }

    Ok("END Invalid input. Please dial again.".to_string())
}

fn extract_vehicle_id(service_code: &str) -> Option<&str> {
    // "*384*NCH23#" → "NCH23"
    let inner = service_code.trim_start_matches('*').trim_end_matches('#');
    let parts: Vec<&str> = inner.split('*').collect();
    parts.get(1).copied()
}
```

---

## 13. Daraja Integration

### `src/services/daraja.rs`

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose, Engine};
use chrono::Utc;
use anyhow::Result;
use crate::config::Config;

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

#[derive(Deserialize)]
pub struct StkPushResponse {
    #[serde(rename = "CheckoutRequestID")]
    pub checkout_request_id: String,
    #[serde(rename = "ResponseCode")]
    pub response_code: String,
    #[serde(rename = "ResponseDescription")]
    pub response_description: String,
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

    async fn get_access_token(&self) -> Result<String> {
        let credentials = general_purpose::STANDARD.encode(
            format!("{}:{}", self.config.daraja_consumer_key, self.config.daraja_consumer_secret)
        );

        let resp: AccessTokenResponse = self.client
            .get(format!("{}/oauth/v1/generate?grant_type=client_credentials", self.config.daraja_base_url))
            .header("Authorization", format!("Basic {}", credentials))
            .send()
            .await?
            .json()
            .await?;

        Ok(resp.access_token)
    }

    fn generate_password(&self, timestamp: &str) -> String {
        let raw = format!(
            "{}{}{}",
            self.config.daraja_shortcode,
            self.config.daraja_passkey,
            timestamp
        );
        general_purpose::STANDARD.encode(raw.as_bytes())
    }

    pub async fn stk_push(
        &self,
        phone: &str,        // "254712345678"
        amount_kes: i32,
        paybill: &str,
        description: &str,
        account_ref: &str,
    ) -> Result<StkPushResponse> {
        let token = self.get_access_token().await?;
        let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
        let password = self.generate_password(&timestamp);

        let payload = StkPushPayload {
            business_short_code: self.config.daraja_shortcode.clone(),
            password,
            timestamp,
            transaction_type: "CustomerBuyGoodsOnline".to_string(),
            amount: amount_kes,
            party_a: phone.to_string(),
            party_b: paybill.to_string(),
            phone_number: phone.to_string(),
            callback_url: self.config.daraja_callback_url.clone(),
            account_reference: account_ref[..std::cmp::min(12, account_ref.len())].to_string(),
            transaction_desc: description[..std::cmp::min(13, description.len())].to_string(),
        };

        let resp: StkPushResponse = self.client
            .post(format!(
                "{}/mpesa/stkpush/v1/processrequest",
                self.config.daraja_base_url
            ))
            .header("Authorization", format!("Bearer {}", token))
            .json(&payload)
            .send()
            .await?
            .json()
            .await?;

        Ok(resp)
    }
}
```

---

## 14. Africa's Talking Integration

### `src/services/africastalking.rs`

Used for sending SMS receipts to feature phone users after payment confirmation.

```rust
use reqwest::Client;
use anyhow::Result;
use crate::config::Config;

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

    pub async fn send_sms(&self, phone: &str, message: &str) -> Result<()> {
        // AT expects phone in international format: +254...
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
```

---

## 15. Daraja Webhook Receiver

### `src/handlers/webhook.rs`

This is the most critical handler — Safaricom calls this URL when the passenger completes (or fails) their M-Pesa payment. We update the payment status and instantly push to the conductor's display.

```rust
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{
    AppState,
    db::payments::confirm_payment,
    domain::payment::PaymentConfirmedEvent,
    services::africastalking::ATService,
    error::AppError,
};

/// Daraja callback payload structure
#[derive(Deserialize, Debug)]
pub struct DarajaCallback {
    #[serde(rename = "Body")]
    pub body: CallbackBody,
}

#[derive(Deserialize, Debug)]
pub struct CallbackBody {
    #[serde(rename = "stkCallback")]
    pub stk_callback: StkCallback,
}

#[derive(Deserialize, Debug)]
pub struct StkCallback {
    #[serde(rename = "MerchantRequestID")]
    pub merchant_request_id: String,
    #[serde(rename = "CheckoutRequestID")]
    pub checkout_request_id: String,
    #[serde(rename = "ResultCode")]
    pub result_code: i32,   // 0 = success
    #[serde(rename = "ResultDesc")]
    pub result_desc: String,
    #[serde(rename = "CallbackMetadata")]
    pub callback_metadata: Option<CallbackMetadata>,
}

#[derive(Deserialize, Debug)]
pub struct CallbackMetadata {
    #[serde(rename = "Item")]
    pub item: Vec<MetadataItem>,
}

#[derive(Deserialize, Debug)]
pub struct MetadataItem {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Value")]
    pub value: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct CallbackAck {
    #[serde(rename = "ResultCode")]
    result_code: i32,
    #[serde(rename = "ResultDesc")]
    result_desc: String,
}

/// POST /api/daraja/callback
pub async fn daraja_callback(
    State(state): State<AppState>,
    Json(payload): Json<DarajaCallback>,
) -> Json<CallbackAck> {
    let cb = &payload.body.stk_callback;

    if cb.result_code != 0 {
        tracing::warn!(
            checkout_id = %cb.checkout_request_id,
            result_code = cb.result_code,
            desc = %cb.result_desc,
            "Payment failed or cancelled"
        );
        // Mark as failed in DB
        let _ = sqlx::query!(
            "UPDATE payments SET status = 'failed' WHERE checkout_request_id = $1",
            cb.checkout_request_id
        )
        .execute(&state.db)
        .await;

        return Json(CallbackAck {
            result_code: 0,
            result_desc: "Accepted".to_string(),
        });
    }

    // Extract M-Pesa receipt number from metadata
    let mpesa_ref = cb.callback_metadata.as_ref()
        .and_then(|m| m.item.iter().find(|i| i.name == "MpesaReceiptNumber"))
        .and_then(|i| i.value.as_ref())
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string();

    // Confirm payment in DB
    match confirm_payment(&state.db, &cb.checkout_request_id, &mpesa_ref).await {
        Ok(Some(payment)) => {
            tracing::info!(
                payment_id = %payment.id,
                mpesa_ref = %mpesa_ref,
                phone = %payment.passenger_phone,
                "Payment confirmed"
            );

            // Broadcast to conductor WebSocket
            let event = PaymentConfirmedEvent {
                event: "payment_confirmed".to_string(),
                passenger_phone: payment.passenger_phone.clone(),
                amount_kes: payment.amount / 100,
                mpesa_ref: mpesa_ref.clone(),
                channel: payment.channel.clone(),
                trip_id: payment.trip_id,
            };

            let _ = state.ws_tx.send(serde_json::to_string(&event).unwrap_or_default());

            // Send SMS receipt to passenger (especially important for feature phone users)
            let at = ATService::new(&state.config);
            let sms = format!(
                "TRANSIT: Ksh {} fare paid. Ref: {}. Safe travels!",
                payment.amount / 100, mpesa_ref
            );
            let _ = at.send_sms(&payment.passenger_phone, &sms).await;
        }
        Ok(None) => {
            tracing::warn!(
                checkout_id = %cb.checkout_request_id,
                "Callback received for unknown checkout ID"
            );
        }
        Err(e) => {
            tracing::error!("Failed to confirm payment: {:?}", e);
        }
    }

    // Always return success to Daraja — important, otherwise they retry
    Json(CallbackAck {
        result_code: 0,
        result_desc: "Accepted".to_string(),
    })
}
```

---

## 16. Conductor WebSocket Feed

### `src/handlers/ws.rs`

The conductor's device connects here. Every payment confirmation is instantly pushed — no polling, no SMS wait.

```rust
use axum::{
    extract::{State, WebSocketUpgrade, ws::{WebSocket, Message}},
    response::Response,
};
use futures::{sink::SinkExt, stream::StreamExt};
use crate::AppState;

/// GET /api/conductor/ws
pub async fn conductor_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_tx.subscribe();

    // Task: forward payment events to conductor
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Task: handle ping/close from conductor side
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Close(_) = msg {
                break;
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}
```

---

## 17. Redis Session Cache

### `src/cache/session.rs`

```rust
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use anyhow::Result;

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

pub struct Cache {
    pub client: redis::Client,
}

impl Cache {
    pub fn new(redis_url: &str) -> Result<Self> {
        Ok(Self {
            client: redis::Client::open(redis_url)?,
        })
    }

    pub async fn save_ussd_session(&self, session_id: &str, session: &UssdSession) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ussd:{}", session_id);
        let value = serde_json::to_string(session)?;
        // TTL of 60 seconds — well beyond USSD 30s timeout
        conn.set_ex::<_, _, ()>(key, value, 60).await?;
        Ok(())
    }

    pub async fn get_ussd_session(&self, session_id: &str) -> Result<Option<UssdSession>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ussd:{}", session_id);
        let value: Option<String> = conn.get(key).await?;
        Ok(value.and_then(|v| serde_json::from_str(&v).ok()))
    }

    pub async fn delete_ussd_session(&self, session_id: &str) -> Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let key = format!("ussd:{}", session_id);
        conn.del::<_, ()>(key).await?;
        Ok(())
    }
}
```

---

## 18. Main Server Entry Point

### `src/config.rs`

```rust
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
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("HOST").unwrap_or("0.0.0.0".into()),
            port: std::env::var("PORT").unwrap_or("8080".into()).parse().unwrap_or(8080),
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL required"),
            redis_url: std::env::var("REDIS_URL").expect("REDIS_URL required"),
            daraja_base_url: std::env::var("DARAJA_BASE_URL").expect("DARAJA_BASE_URL required"),
            daraja_consumer_key: std::env::var("DARAJA_CONSUMER_KEY").expect("required"),
            daraja_consumer_secret: std::env::var("DARAJA_CONSUMER_SECRET").expect("required"),
            daraja_passkey: std::env::var("DARAJA_PASSKEY").expect("required"),
            daraja_shortcode: std::env::var("DARAJA_SHORTCODE").expect("required"),
            daraja_callback_url: std::env::var("DARAJA_CALLBACK_URL").expect("required"),
            at_username: std::env::var("AT_USERNAME").expect("required"),
            at_api_key: std::env::var("AT_API_KEY").expect("required"),
            at_sender_id: std::env::var("AT_SENDER_ID").unwrap_or("TRANSIT".into()),
            jwt_secret: std::env::var("JWT_SECRET").expect("required"),
            qr_base_url: std::env::var("QR_BASE_URL").expect("required"),
        }
    }
}
```

### `src/error.rs`

```rust
use axum::{response::{IntoResponse, Response}, http::StatusCode, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Internal(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            AppError::Database(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };

        (status, Json(json!({"error": message}))).into_response()
    }
}
```

### `src/main.rs`

```rust
mod config;
mod error;
mod domain;
mod db;
mod handlers;
mod services;
mod cache;

use axum::{
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub cache: Arc<cache::session::Cache>,
    pub config: config::Config,
    pub ws_tx: broadcast::Sender<String>,  // payment events → conductor WS
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = config::Config::from_env();

    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&db).await?;

    let cache = Arc::new(cache::session::Cache::new(&config.redis_url)?);

    // Broadcast channel for conductor WebSocket updates
    let (ws_tx, _) = broadcast::channel::<String>(256);

    let state = AppState { db, cache, config: config.clone(), ws_tx };

    let app = Router::new()
        // Passenger routes
        .route("/api/pay/qr", post(handlers::stk::initiate_stk_payment))
        .route("/api/ussd", post(handlers::ussd::handle_ussd))

        // Daraja webhook
        .route("/api/daraja/callback", post(handlers::webhook::daraja_callback))

        // Conductor routes
        .route("/api/conductor/trip", post(handlers::conductor::update_trip))
        .route("/api/qr/:vehicle_short_id", get(handlers::qr::get_qr))
        .route("/api/conductor/ws", get(handlers::ws::conductor_ws))

        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("Server running on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
```

---

## 19. Docker Setup

### `Dockerfile`

```dockerfile
FROM rust:1.78-slim as builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/nairobi-transit /usr/local/bin/
COPY --from=builder /app/migrations /migrations
CMD ["nairobi-transit"]
```

### `docker-compose.yml`

```yaml
version: '3.9'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: transit
      POSTGRES_PASSWORD: transit
      POSTGRES_DB: nairobi_transit
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U transit"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

---

## 20. Running the System

> **Current production deployment**: DigitalOcean App Platform — push to `main` → auto-deploy. See `README.md` and `.do/app.yaml`. For local development, use the quick start below.

### First-time setup (local)

```bash
# 1. Clone and enter project
git clone <your-repo>
cd nairobi-transit/server

# 2. Copy and fill in credentials
cp .env.example .env
# Fill in Daraja sandbox keys from developer.safaricom.co.ke
# Fill in Africa's Talking sandbox keys from africastalking.com

# 3. Start databases (from project root)
docker compose up db redis -d

# 4. Run the server
RUST_LOG=info cargo run
# Migrations run automatically
```

### Register your first vehicle (one-time, via psql or admin script)

```sql
INSERT INTO vehicles (plate, short_id, sacco_name, paybill_no)
VALUES ('KDA 123A', 'NCH23', 'City Hoppa SACCO', '123456');

INSERT INTO conductors (phone, name, vehicle_id, pin_hash)
VALUES ('+254712345678', 'John Kamau',
    (SELECT id FROM vehicles WHERE short_id = 'NCH23'),
        '$2b$12$...');  -- bcrypt hash of conductor's PIN
```

### Test the payment flow locally

```bash
# 1. Conductor sets trip
curl -X POST http://localhost:8080/api/conductor/trip \
  -H "Content-Type: application/json" \
  -d '{
    "auth": {
      "conductor_id": "<uuid>",
      "vehicle_id": "<uuid>"
    },
    "trip": {
      "route": "CBD → Kasarani",
      "destination": "Kasarani Stage",
      "fare_amount": 60
    }
  }'

# 2. Passenger initiates payment (smartphone)
curl -X POST http://localhost:8080/api/pay/qr \
  -H "Content-Type: application/json" \
  -d '{
        "vehicle_short_id": "NCH23",
    "passenger_phone": "0712345678"
  }'

# 3. Simulate Daraja callback (for local testing)
curl -X POST http://localhost:8080/api/daraja/callback \
  -H "Content-Type: application/json" \
  -d '{
    "Body": {
      "stkCallback": {
        "MerchantRequestID": "test-001",
        "CheckoutRequestID": "<id-from-step-2>",
        "ResultCode": 0,
        "ResultDesc": "The service request is processed successfully.",
        "CallbackMetadata": {
          "Item": [
            {"Name": "Amount", "Value": 60},
            {"Name": "MpesaReceiptNumber", "Value": "QHX2B3K9LP"},
            {"Name": "PhoneNumber", "Value": 254712345678}
          ]
        }
      }
    }
  }'
```

### Daraja sandbox setup (developer.safaricom.co.ke)

1. Register at `developer.safaricom.co.ke`
2. Create an app → get Consumer Key + Secret
3. Under **Lipa Na M-Pesa Online** → get your sandbox Passkey
4. Register callback URL (use ngrok for local: `ngrok http 8080`)
5. Test with Daraja sandbox STK Push test numbers

### Africa's Talking setup (africastalking.com)

1. Register at `africastalking.com`
2. Create sandbox app
3. Under **USSD** → register your shortcode `*384#` (sandbox gives you a test code)
4. Set callback URL to `https://yourdomain.com/api/ussd`
5. Test using their USSD simulator in the dashboard

---

## 21. API Reference

| Method | Endpoint | Who calls it | Purpose |
|---|---|---|---|
| `POST` | `/api/conductor/trip` | Conductor app | Set/update route, destination, fare |
| `GET` | `/api/qr/:vehicle_short_id` | Conductor app | Get QR code for current trip |
| `POST` | `/api/pay/qr` | Passenger browser (after QR scan) | Initiate STK Push |
| `POST` | `/api/ussd` | Africa's Talking gateway | Handle feature phone USSD session |
| `POST` | `/api/daraja/callback` | Safaricom servers | Payment confirmed/failed webhook |
| `GET` | `/api/conductor/ws` | Conductor app (WebSocket) | Live payment confirmation feed |

---

## 22. End-to-End Flow Summary

### Smartphone Passenger

```
1. Board matatu
2. Scan QR sticker on seat (shows route, destination, fare automatically)
3. Browser opens → enters phone number → taps "Pay Ksh 60"
4. STK Push pops up on their phone
5. Enter M-Pesa PIN → tap OK
6. Conductor's screen shows green ✓ within 3 seconds
7. Passenger gets SMS receipt with M-Pesa ref
```

### Feature Phone Passenger

```
1. Board matatu
2. See sticker: "Dial *384*NCH23#"
3. Dial → screen shows: "CBD→Kasarani | Dest: Kasarani Stage | Fare: Ksh 60"
4. Press 1 → enter their number → press 1 to confirm
5. STK Push fires to their phone
6. Enter M-Pesa PIN
7. Conductor's screen shows green ✓
8. SMS receipt arrives with M-Pesa ref
```

### Conductor (Start of Every Trip)

```
1. Open conductor app / web dashboard
2. Set route: "CBD → Kasarani"
3. Set destination: "Kasarani Stage"
4. Set fare: 60
5. Save → QR auto-updates, USSD code stays same (*384*NCH23#)
6. Watch live payment feed on screen — no chasing passengers
```

### What Makes This Unstoppable

- **No wrong numbers** — passengers never type a number
- **No SMS dependency** — conductor gets webhook confirmation directly
- **No Fuliza risk** — money goes to SACCO Paybill
- **No reversal abuse** — C2B Paybill requires formal dispute process
- **No "what route is this?"** — route + destination shown before payment
- **No internet needed** — feature phones fully covered via USSD
- **No cash needed** — both channels work for any passenger

---

*Built with Rust + Axum + PostgreSQL + Redis + Daraja 3.0 + Africa's Talking*
