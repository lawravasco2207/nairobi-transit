-- Vehicles: each matatu registered in the system
CREATE TABLE IF NOT EXISTS vehicles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate       VARCHAR(20) UNIQUE NOT NULL,
    short_id    VARCHAR(10) UNIQUE NOT NULL,  -- e.g. "NRB23" used in USSD *384*NRB23#
    sacco_name  VARCHAR(100) NOT NULL,
    paybill_no  VARCHAR(20) NOT NULL,         -- SACCO's registered Daraja Paybill
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast USSD lookup by short_id
CREATE INDEX IF NOT EXISTS idx_vehicles_short_id ON vehicles(short_id);
