-- Payments: every fare transaction
CREATE TABLE IF NOT EXISTS payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id             UUID NOT NULL REFERENCES trips(id),
    passenger_phone     VARCHAR(15) NOT NULL,
    amount              INTEGER NOT NULL,             -- KES cents
    channel             VARCHAR(20) NOT NULL,         -- 'stk' | 'ussd'
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed
    mpesa_ref           VARCHAR(50),                  -- M-Pesa transaction code
    checkout_request_id VARCHAR(100),                 -- Daraja STK checkout ID
    idempotency_key     VARCHAR(100) UNIQUE NOT NULL, -- prevents double-charge
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id);
CREATE INDEX IF NOT EXISTS idx_payments_checkout ON payments(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_payments_phone ON payments(passenger_phone);
