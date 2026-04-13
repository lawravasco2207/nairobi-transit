-- ── Transit Stops (matatu stages and landmarks) ─────────────────────────────
CREATE TABLE IF NOT EXISTS transit_stops (
    id              SERIAL PRIMARY KEY,
    external_id     TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    stage_name      TEXT,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    landmark_aliases TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_stops_lat    ON transit_stops (lat);
CREATE INDEX IF NOT EXISTS idx_stops_lon    ON transit_stops (lon);
CREATE INDEX IF NOT EXISTS idx_stops_name   ON transit_stops (name);
CREATE INDEX IF NOT EXISTS idx_stops_extid  ON transit_stops (external_id);

-- ── Transit Routes (matatu lines) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transit_routes (
    id                  SERIAL PRIMARY KEY,
    external_id         TEXT UNIQUE NOT NULL,
    route_number        TEXT NOT NULL,          -- "23"
    route_name          TEXT NOT NULL,          -- "CBD → Kasarani"
    origin              TEXT NOT NULL,
    destination         TEXT NOT NULL,
    stage               TEXT,                   -- Boarding stage name
    stage_lat           DOUBLE PRECISION,
    stage_lon           DOUBLE PRECISION,
    typical_fare_min    INT,                    -- KES
    typical_fare_max    INT                     -- KES
);

CREATE INDEX IF NOT EXISTS idx_routes_number ON transit_routes (route_number);

-- ── Stop ↔ Route Mapping ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_stops (
    route_id            INT NOT NULL REFERENCES transit_routes(id) ON DELETE CASCADE,
    stop_id             INT NOT NULL REFERENCES transit_stops(id)  ON DELETE CASCADE,
    stop_sequence       INT NOT NULL,           -- 1 = first stop on route
    distance_from_origin FLOAT DEFAULT 0,       -- meters
    PRIMARY KEY (route_id, stop_id)
);

CREATE INDEX IF NOT EXISTS idx_route_stops_route ON route_stops (route_id, stop_sequence);
CREATE INDEX IF NOT EXISTS idx_route_stops_stop  ON route_stops (stop_id);

-- ── Transit Graph (precomputed edges for A→B routing) ────────────────────────
CREATE TABLE IF NOT EXISTS transit_graph (
    id              SERIAL PRIMARY KEY,
    from_stop_id    INT NOT NULL REFERENCES transit_stops(id)  ON DELETE CASCADE,
    to_stop_id      INT NOT NULL REFERENCES transit_stops(id)  ON DELETE CASCADE,
    route_id        INT NOT NULL REFERENCES transit_routes(id) ON DELETE CASCADE,
    cost_minutes    FLOAT NOT NULL DEFAULT 5.0,
    fare_kes        INT   NOT NULL DEFAULT 50,
    UNIQUE (from_stop_id, to_stop_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_from ON transit_graph (from_stop_id);
CREATE INDEX IF NOT EXISTS idx_graph_to   ON transit_graph (to_stop_id);

-- ── Live Vehicle Locations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_locations (
    vehicle_id  UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    trip_id     UUID REFERENCES trips(id) ON DELETE SET NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    heading     FLOAT,
    speed_kmh   FLOAT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_veh_loc_updated ON vehicle_locations (updated_at);

-- ── Crowdsourced Route Reports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_reports (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type             TEXT NOT NULL CHECK (report_type IN (
                                'route_change','stage_change','congestion',
                                'flooding','police_check','other')),
    route_id                INT REFERENCES transit_routes(id) ON DELETE SET NULL,
    stop_id                 INT REFERENCES transit_stops(id)  ON DELETE SET NULL,
    description             TEXT NOT NULL,
    reporter_phone          TEXT,
    confirmed_by_conductor  BOOLEAN DEFAULT FALSE,
    upvotes                 INT NOT NULL DEFAULT 0,
    expires_at              TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 hours'),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_route   ON route_reports (route_id);
CREATE INDEX IF NOT EXISTS idx_reports_expires ON route_reports (expires_at);
