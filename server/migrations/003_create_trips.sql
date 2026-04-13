-- Trips: each journey a conductor starts
CREATE TABLE IF NOT EXISTS trips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      UUID NOT NULL REFERENCES vehicles(id),
    conductor_id    UUID NOT NULL REFERENCES conductors(id),
    route           VARCHAR(100) NOT NULL,       -- e.g. "CBD → Kasarani"
    destination     VARCHAR(100) NOT NULL,       -- e.g. "Kasarani Stage"
    fare_amount     INTEGER NOT NULL,            -- in KES cents (6000 = Ksh 60)
    status          VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | ended
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ
);

-- Only one active trip per vehicle at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip
    ON trips(vehicle_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id);
