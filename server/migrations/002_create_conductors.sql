-- Conductors: operators assigned to vehicles
CREATE TABLE IF NOT EXISTS conductors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       VARCHAR(15) UNIQUE NOT NULL,   -- +254...
    name        VARCHAR(100) NOT NULL,
    vehicle_id  UUID REFERENCES vehicles(id),
    pin_hash    VARCHAR(255) NOT NULL,          -- bcrypt hash of conductor PIN
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
