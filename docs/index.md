> **Note:** The canonical source of truth for these docs is now `frontend/src/content/docs.md`.
> Edit that file — it renders live at `/docs` on the app site.
> This file is kept as a reference copy only.

# Nairobi Transit — Technical Documentation

Nairobi Transit is a cashless fare payment system built for Nairobi's matatu (minibus) network. It supports M-Pesa STK Push for smartphone users and USSD for feature phones, giving every passenger a way to pay without cash — regardless of device.

---

## Table of Contents

1. [Problems This Solves](#1-problems-this-solves)
2. [Problems This Faces](#2-problems-this-faces)
3. [Architecture](#3-architecture)
4. [GIS Data & Research](#4-gis-data--research)
5. [Daraja API Integration (M-Pesa)](#5-daraja-api-integration-m-pesa)
6. [USSD Integration (Africa's Talking)](#6-ussd-integration-africas-talking)
7. [Database Schema](#7-database-schema)
8. [API Reference](#8-api-reference)
9. [End-to-End Payment Flows](#9-end-to-end-payment-flows)
10. [Frontend Pages](#10-frontend-pages)
11. [Deployment](#11-deployment)

---

## 1. Problems This Solves

Nairobi's matatu industry handles millions of daily trips, almost entirely in cash. This creates a cluster of well-known problems:

| Problem | How this system addresses it |
|---------|------------------------------|
| Passengers don't know the correct fare | Conductor sets fare at trip start; system shows it before payment is made |
| Passengers don't know the route or destination | Conductor sets route + destination; encoded in QR code and USSD prompt |
| M-Pesa confirmation SMS is slow → fare disputes | Confirmation goes directly to conductor dashboard via webhook — not SMS |
| Passengers must type their phone number | QR code or `*384*[VehicleCode]#` dials the vehicle directly — no manual entry |
| Feature phone users can't use app-based payments | USSD flow works on any GSM handset, no data connection required |
| Conductor's personal M-Pesa line is exposed | Money goes to SACCO Paybill number, never a personal line |
| Cash-in-hand attracts robbery | Cashless reduces the incentive for conductor muggings |
| Reversal abuse ("it didn't go through") | C2B Paybill reversals require a formal process, not a phone call |

---

## 2. Problems This Faces

No system eliminates all problems — some existing ones are made better, and some new ones are created:

### Network & Infrastructure
- **Spotty 4G in matatus**: USSD works even on 2G with low signal, but STK Push and WebSocket connections require a usable data connection. Network dropouts mid-journey are common on some corridors.
- **WebSocket reliability**: Conductor payment notifications use persistent WebSocket connections. If the connection drops and the conductor doesn't notice, payments may not show. A polling fallback would be more robust.

### Adoption
- **Habit resistance**: Conductors and passengers have used cash for decades. Even with a working system, uptake takes sustained effort, SACCO mandates, or passenger-side incentives.
- **SACCO buy-in**: The system routes money to a SACCO Paybill number. If the SACCO doesn't adopt the system, individual conductors can't use production Paybill.

### Regulatory
- **CBK licensing**: Operating a C2B Paybill for third parties in Kenya requires Central Bank of Kenya oversight. Production deployment needs Safaricom approval for a shortcode and a properly registered Paybill. The sandbox has no such requirement.
- **KRA & revenue tracing**: Cashless creates an automatic audit trail — which is good for SACCO accountability but may create friction with operators who prefer opaque cash flows.

### Technical / Known Limitations
- **USSD session timeout**: Africa's Talking's default session timeout is 30 seconds. A passenger who takes longer than that to enter their PIN will need to re-dial.
- **GIS data is outdated**: The route and stop data (see [section 4](#4-gis-data--research)) is from 2019 and does not reflect route changes made since then. Nairobi's matatu routes change frequently and informally.
- **`distance_from_origin` not populated**: The `route_stops` table has a `distance_from_origin` column, but it is set to `0.0` for all rows. Route geometry was removed when PostGIS was dropped in favour of Haversine math; stop ordering uses sequence numbers only.
- **Single-region deployment**: The current DO App Platform spec deploys to one region. A matatu breakdown hotspot at peak hour could overload the backend if all conductor apps reconnect simultaneously.
- **Sandbox only**: The application currently runs against Safaricom's sandbox environment. Production requires CBK-registered shortcodes and Safaricom production credentials.

---

## 3. Architecture

```
  Passenger (QR)          Passenger (USSD)         Conductor
       │                       │                       │
       ▼                       ▼                       ▼
  ┌────────────────────────────────────────────────────┐
  │              Next.js Frontend (port 3000)           │
  │  React 19 · Tailwind v4 · TypeScript               │
  └──────────────────────┬─────────────────────────────┘
                         │ REST + WebSocket
  ┌──────────────────────▼─────────────────────────────┐
  │              Rust / Axum API (port 8080)            │
  │                                                     │
  │  handlers/        services/        cache/           │
  │  ├── qr.rs        ├── daraja.rs    └── session.rs   │
  │  ├── stk.rs       ├── africastalking.rs             │
  │  ├── ussd.rs      └── qr_generator.rs              │
  │  ├── webhook.rs                                     │
  │  ├── conductor.rs   db/                             │
  │  ├── ws.rs          ├── vehicles.rs                │
  │  └── registration   ├── trips.rs                   │
  │                     └── payments.rs                │
  └──┬───────────────┬────────────────┬────────────────┘
     │               │                │
     ▼               ▼                ▼
  Daraja 3.0    Africa's Talking   PostgreSQL 18.3
  (Safaricom)   (USSD + SMS)       (DigitalOcean)
  STK Push                          + Azure Redis
  Webhook                           (session cache)
```

### Technology Choices

| Component | Choice | Why |
|-----------|--------|-----|
| Backend language | Rust (Axum) | Compile-time safety, low memory on a $6/mo DO dyno |
| Database | PostgreSQL 18.3 | ACID, `pg_trgm` for fuzzy stop name search |
| Cache | Azure Redis | USSD sessions need sub-millisecond TTL-backed storage |
| Frontend | Next.js 15 / React 19 | SSR for map page, easy Tailwind integration |
| Payment | Daraja 3.0 STK Push | Standard Kenyan payment rail, no card infrastructure needed |
| USSD | Africa's Talking | Best developer experience + Kenya coverage |
| GIS | Haversine in SQL | No PostGIS extension — works on managed PG without superuser |
| Deployment | DO App Platform | Push-to-deploy, managed TLS, affordable |

---

## 4. GIS Data & Research

### Source: Digital Matatus Project

> ⚠️ **The GIS data in this repository is from 2019 and may be significantly outdated.** Nairobi's matatu routes change frequently and informally. Do not rely on this data for real-time navigation.

The stop and route data in `GIS_DATA_2019/` and seeded into the database comes from the **Digital Matatus** project, a landmark civic technology initiative that mapped Nairobi's informal transit network using GTFS (General Transit Feed Specification) format for the first time.

**Project partners:**
- [MIT Civic Data Design Lab](https://civicdatadesignlab.mit.edu/) (Massachusetts Institute of Technology)
- University of Nairobi, Department of Urban & Regional Planning
- Columbia University
- Groupshot

**Data collection period:** 2012–2015  
**Shapefile snapshot used in this repo:** 2019

**Key outputs:**
- 4,284 matatu stops mapped across Nairobi and its suburbs
- 136 routes modelled as GTFS routes
- Full GTFS feed (stops.txt, routes.txt, shapes.txt, trips.txt, stop_times.txt)

**Project website:** http://www.digitalmatatus.com  
**Interactive map:** http://www.digitalmatatus.com/map.html  
**Academic paper:** Williams, S., Klopp, J., Bertini, D., Waiganjo, P., & White, A. (2015). *Digital Matatus: Using Mobile Technology to Map Transit Data in Developing Cities.* Transportation Research Record.

### Why the Data May Be Outdated

Nairobi's matatus operate under route licences issued by the National Transport and Safety Authority (NTSA), but routes are frequently altered through informal agreements, traffic conditions, and market forces. The Digital Matatus data captured a snapshot of the network as it existed circa 2012–2014. Since then:

- New routes have been created (e.g. BRT corridors)
- Several routes have had termini shifted
- NTSA has regulated and deregistered some routes
- Rapid urban expansion on the outskirts has made some stops obsolete

**What this means for the system:** Stop names and coordinates are good enough for nearby-stop lookups and fare routing, but should not be treated as authoritative for customer-facing navigation without a data refresh.

### How GIS Data Flows into the Database

```
GIS_DATA_2019/
├── stops.shp / .dbf   →   scripts/generate_gis_sql.py   →   migrations/006_seed_gis_data.sql
└── shapes.shp / .dbf  →   (shapefile parser)            →   (4,284 stops, 136 routes seeded)
```

The Python script reads the shapefiles, normalises coordinates, and emits SQL `INSERT` statements. Migration 006 seeds this data on first startup. Migration 007 creates stop aliases and enables `pg_trgm` extensions for fuzzy name matching.

---

## 5. Daraja API Integration (M-Pesa)

### What is Daraja?

Daraja is Safaricom's developer API for M-Pesa — Kenya's dominant mobile money network. This system uses the **Lipa Na M-Pesa Online (STK Push)** product to prompt passengers to approve payments directly on their phone.

### How STK Push Works

1. **Backend initiates**: The server calls `POST /mpesa/stkpush/v1/processrequest` with the passenger's phone, amount, and callback URL
2. **Safaricom sends prompt**: A push notification appears on the passenger's Safaricom handset asking them to enter their M-Pesa PIN
3. **Passenger approves**: The passenger enters their PIN; Safaricom processes the payment
4. **Safaricom calls back**: Safaricom sends a POST request to `DARAJA_CALLBACK_URL` with the result
5. **Backend confirms**: The webhook handler marks the payment confirmed and notifies the conductor via WebSocket

### Sandbox Credentials

| Parameter | Value |
|-----------|-------|
| Base URL | `https://sandbox.safaricom.co.ke` |
| Shortcode (Paybill) | `174379` |
| Passkey | `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919` |
| Test phone number | `254708374149` |

**The test phone number `254708374149`** is Safaricom's sandbox test consumer. STK Push initiated in sandbox mode goes to this number. The prompt is simulated — **no real money is transferred and no charges are made to any real Safaricom account**, even if a real phone number is used as the initiating number.

### Using a Real Phone Number in Sandbox

When a real Safaricom number (e.g. `254712345678`) is used as the payer in sandbox:
- The STK Push request is **accepted** by the API
- The push prompt appears **on the test phone `254708374149`**, not on the real number
- No money is moved
- The callback comes through to your webhook as a successful transaction

This makes sandbox testing realistic without involving real funds.

### Moving to Production

To go live:
1. Register a Safaricom Paybill (requires business registration + CBK compliance)
2. Apply for a production Safaricom Daraja account at developer.safaricom.co.ke
3. Set `DARAJA_BASE_URL=https://api.safaricom.co.ke` in production env
4. Replace `DARAJA_SHORTCODE`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_PASSKEY` with production values
5. Ensure `DARAJA_CALLBACK_URL` is a publicly reachable HTTPS URL

### Key API Calls

#### Authenticate
```
POST https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
Authorization: Basic base64(consumerKey:consumerSecret)
```

#### STK Push
```
POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
{
  "BusinessShortCode": "174379",
  "Password": base64(shortcode + passkey + timestamp),
  "Timestamp": "20240101120000",
  "TransactionType": "CustomerPayBillOnline",
  "Amount": 60,
  "PartyA": "254708374149",
  "PartyB": "174379",
  "PhoneNumber": "254708374149",
  "CallBackURL": "https://yourdomain.com/api/daraja/callback",
  "AccountReference": "TRIP-{trip_id}",
  "TransactionDesc": "Matatu fare"
}
```

#### Callback (received by the system)
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "...",
      "CheckoutRequestID": "...",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          {"Name": "Amount", "Value": 60},
          {"Name": "MpesaReceiptNumber", "Value": "QHX7ABC123"},
          {"Name": "PhoneNumber", "Value": 254708374149}
        ]
      }
    }
  }
}
```

`ResultCode: 0` means success. Any other code is a failure (1032 = cancelled by user, 1037 = timeout).

---

## 6. USSD Integration (Africa's Talking)

USSD (Unstructured Supplementary Service Data) lets passengers interact with the payment system using any GSM phone — no internet, no app, no smartphone required.

**USSD code:** `*384*[VehicleCode]#` (e.g. `*384*NCH23#`)

### Session Flow

```
Dial *384*NCH23#
  │
  ├─► CON "NCH23 — CBD → Kasarani
  │         Fare: KES 60
  │         1. Pay now
  │         2. Cancel"
  │
  ├─ 1 ──► CON "Enter your M-Pesa number:"
  │
  ├─ 254712... ──► CON "Confirm KES 60 to Kasarani Stage
  │                       SACCO Paybill 174379?
  │                       1. Confirm
  │                       2. Cancel"
  │
  ├─ 1 ──► END "Payment initiated. Enter PIN on your phone."
```

### Session State (Redis)
Each USSD session (identified by `sessionId` from Africa's Talking) stores:
```json
{
  "step": 2,
  "vehicle_code": "NCH23",
  "trip_id": "uuid",
  "fare_kes": 60,
  "phase": "awaiting_phone"
}
```
Sessions expire in 5 minutes. If the session drops, the passenger re-dials.

---

## 7. Database Schema

Seven migrations run automatically on server startup.

### Core Tables

**vehicles**
```sql
id           UUID PRIMARY KEY
short_id     TEXT UNIQUE          -- e.g. "NCH23"
plate_number TEXT
sacco_name   TEXT
paybill      TEXT
created_at   TIMESTAMPTZ
```

**conductors**
```sql
id           UUID PRIMARY KEY
name         TEXT
phone        TEXT UNIQUE
pin_hash     TEXT                 -- bcrypt
vehicle_id   UUID REFERENCES vehicles
created_at   TIMESTAMPTZ
```

**trips**
```sql
id           UUID PRIMARY KEY
vehicle_id   UUID REFERENCES vehicles
conductor_id UUID REFERENCES conductors
route        TEXT                 -- e.g. "CBD → Kasarani"
destination  TEXT
fare_kes     INTEGER
is_active    BOOLEAN DEFAULT true
started_at   TIMESTAMPTZ
ended_at     TIMESTAMPTZ
```

**payments**
```sql
id               UUID PRIMARY KEY
trip_id          UUID REFERENCES trips
passenger_phone  TEXT
amount_kes       INTEGER
status           TEXT             -- pending | confirmed | failed
mpesa_ref        TEXT             -- from Daraja callback
channel          TEXT             -- stk | ussd
checkout_req_id  TEXT             -- Daraja checkout ID for matching
created_at       TIMESTAMPTZ
confirmed_at     TIMESTAMPTZ
```

### GIS Tables

**transit_stops**
```sql
id                  UUID PRIMARY KEY
stop_id             TEXT UNIQUE      -- from GTFS
stop_name           TEXT
stop_lat            DOUBLE PRECISION
stop_lon            DOUBLE PRECISION
stop_desc           TEXT
zone_id             TEXT
```

**transit_routes**
```sql
id                  UUID PRIMARY KEY
route_id            TEXT UNIQUE
route_short_name    TEXT
route_long_name     TEXT
route_type          INTEGER          -- 3 = bus/matatu
route_color         TEXT
```

**route_stops** (join table)
```sql
id                  UUID
route_id            UUID REFERENCES transit_routes
stop_id             UUID REFERENCES transit_stops
stop_sequence       INTEGER
distance_from_origin DOUBLE PRECISION  -- currently 0.0 (known limitation)
```

**stop_aliases** (for fuzzy search)
```sql
stop_id   UUID REFERENCES transit_stops
alias     TEXT
```

---

## 8. API Reference

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check → `"ok"` |
| `GET` | `/api/qr/:vehicle_short_id` | Get QR code + trip info for a vehicle |
| `POST` | `/api/pay/qr` | Initiate STK Push for a passenger |
| `POST` | `/api/ussd` | Africa's Talking USSD callback |
| `POST` | `/api/daraja/callback` | Safaricom STK Push result webhook |
| `GET` | `/api/stops/nearby` | Find stops near coordinates (Haversine) |
| `GET` | `/api/stops/search` | Fuzzy search stops by name |
| `GET` | `/api/routes/:stop_id` | Get routes serving a stop |

### Conductor Endpoints (JWT-protected)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/conductor/register` | Register conductor + vehicle |
| `POST` | `/api/conductor/login` | Login → JWT token |
| `POST` | `/api/conductor/trip` | Start a new trip (set route/fare) |
| `GET` | `/api/conductor/trip` | Get current active trip |
| `DELETE` | `/api/conductor/trip` | End active trip |
| `GET` | `/api/conductor/ws` | WebSocket connection for live payment events |

### System Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | System status (DB, Redis, Daraja health) |
| `POST` | `/api/registration` | Vehicle registration form |

---

## 9. End-to-End Payment Flows

### Flow A: Smartphone Passenger (STK Push)

```
Passenger scans QR code on matatu seat
  │
  ▼
Frontend loads /api/qr/NCH23
→ displays route "CBD → Kasarani", fare KES 60
  │
  ▼
Passenger enters their phone number, taps Pay
  │
  ▼
Frontend: POST /api/pay/qr { vehicle_short_id, phone }
  │
  ▼
Backend: fetches active trip for NCH23
         creates payment record (status=pending)
         calls Daraja STK Push
  │
  ▼
Daraja: sends push notification to passenger's phone
  │
  ▼
Passenger: enters M-Pesa PIN on handset
  │
  ▼
Daraja: calls POST /api/daraja/callback
  │
  ▼
Backend webhook handler:
  - matches CheckoutRequestID → payment record
  - sets status=confirmed, stores MpesaReceiptNumber
  - broadcasts WebSocket event to conductor dashboard
  │
  ▼
Conductor dashboard: displays "KES 60 received from 0712... — QHX7ABC123"
```

### Flow B: Feature Phone Passenger (USSD)

```
Passenger dials *384*NCH23#
  │
  ▼
Africa's Talking: POST /api/ussd { sessionId, serviceCode, text="", phoneNumber }
  │
  ▼
Backend: step 0 — fetches trip for NCH23
  - stores session in Redis
  - responds: CON "CBD → Kasarani | KES 60\n1. Pay\n2. Cancel"
  │
  ▼
Passenger: presses 1
  │
  ▼
Backend: step 1 — responds: CON "Enter your M-Pesa number:"
  │
  ▼
Passenger: enters 254712345678
  │
  ▼
Backend: step 2 — responds: CON "Confirm KES 60 to paybill 174379?\n1. Confirm\n2. Cancel"
  │
  ▼
Passenger: presses 1
  │
  ▼
Backend: step 3
  - initiates STK Push to 254712345678
  - responds: END "Payment initiated. Enter your PIN."
  │
  ▼
(same as Flow A from STK Push onwards → webhook → conductor WebSocket)
```

---

## 10. Frontend Pages

Built with Next.js 15, React 19, TypeScript, and Tailwind v4. Safaricom green colour scheme (`#00A650`, `#007A3D`).

| Route | Page | Description |
|-------|------|-------------|
| `/` | Passenger home | Map centering on Nairobi, nearby stop search, route finder |
| `/ussd` | USSD simulator | Interactive terminal-style USSD session for testing without a real handset |
| `/register` | Registration | Form to register a new vehicle + conductor |
| `/conductor` | Crew dashboard | Set active trip, view fare, see live payment confirmations, display QR |
| `/settings` | System status | Health check for API, database, Redis, and Daraja |

---

## 11. Deployment

### DigitalOcean App Platform

The `.do/app.yaml` spec defines two components:

- **api** — Rust backend container built from `server/Dockerfile`
- **frontend** — Next.js app built from `frontend/`

Both auto-deploy on push to the `main` branch.

**Initial setup (one-time):**
```bash
# Install doctl
brew install doctl
doctl auth init

# Create the app (edit .do/app.yaml with your repo first)
doctl apps create --spec .do/app.yaml
```

After creation, pushes to `main` trigger rebuilds automatically.

**Required secret env vars (set in DO dashboard):**
- `DATABASE_URL` — DO managed PostgreSQL connection string (with `?sslmode=require`)
- `REDIS_URL` — Azure Redis connection string (with `rediss://` scheme for TLS)
- `DARAJA_CONSUMER_KEY` and `DARAJA_CONSUMER_SECRET`
- `DARAJA_PASSKEY` and `DARAJA_SHORTCODE`
- `DARAJA_CALLBACK_URL` — must be the production HTTPS domain
- `AT_USERNAME` and `AT_API_KEY`
- `JWT_SECRET` — minimum 64 random characters

### Local Development

```bash
# Start PostgreSQL and Redis (via Docker Compose)
docker compose up -d db redis

# Start backend
cd server && cargo run

# Start frontend
cd frontend && npm install && npm run dev
```

The `docker-compose.yml` also supports running the full stack including the Rust service in a container.
