-- ── Stop Aliases & Fuzzy Search ──────────────────────────────────────────────
-- Enables trigram fuzzy search and populates landmark_aliases for every stop
-- with the Nairobi neighbourhood name(s) it falls inside.
-- This allows users to search "CBD", "Westlands", "Kasarani", etc.

-- Trigram extension for fuzzy search (similarity())
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index lets similarity() run fast on the name column
CREATE INDEX IF NOT EXISTS idx_stops_name_trgm
    ON transit_stops USING GIN (lower(name) gin_trgm_ops);

-- ── Helper: append alias only if not already present ─────────────────────────
-- We use a DO block per area so each runs independently.

DO $$
BEGIN

  -- ── CBD / Town Centre ───────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'CBD')
  WHERE lat BETWEEN -1.300 AND -1.270
    AND lon BETWEEN 36.808 AND 36.842
    AND NOT ('CBD' = ANY(landmark_aliases));

  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Town')
  WHERE lat BETWEEN -1.300 AND -1.270
    AND lon BETWEEN 36.808 AND 36.842
    AND NOT ('Town' = ANY(landmark_aliases));

  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Nairobi CBD')
  WHERE lat BETWEEN -1.300 AND -1.270
    AND lon BETWEEN 36.808 AND 36.842
    AND NOT ('Nairobi CBD' = ANY(landmark_aliases));

  -- ── Westlands ───────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Westlands')
  WHERE lat BETWEEN -1.278 AND -1.252
    AND lon BETWEEN 36.795 AND 36.828
    AND NOT ('Westlands' = ANY(landmark_aliases));

  -- ── Parklands ───────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Parklands')
  WHERE lat BETWEEN -1.270 AND -1.250
    AND lon BETWEEN 36.810 AND 36.835
    AND NOT ('Parklands' = ANY(landmark_aliases));

  -- ── Kasarani ────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Kasarani')
  WHERE lat BETWEEN -1.250 AND -1.185
    AND lon BETWEEN 36.870 AND 36.940
    AND NOT ('Kasarani' = ANY(landmark_aliases));

  -- ── Ruaraka / Roysambu ──────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Ruaraka')
  WHERE lat BETWEEN -1.252 AND -1.210
    AND lon BETWEEN 36.845 AND 36.900
    AND NOT ('Ruaraka' = ANY(landmark_aliases));

  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Roysambu')
  WHERE lat BETWEEN -1.230 AND -1.200
    AND lon BETWEEN 36.870 AND 36.925
    AND NOT ('Roysambu' = ANY(landmark_aliases));

  -- ── Eastleigh ───────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Eastleigh')
  WHERE lat BETWEEN -1.282 AND -1.252
    AND lon BETWEEN 36.835 AND 36.870
    AND NOT ('Eastleigh' = ANY(landmark_aliases));

  -- ── Ngara ───────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Ngara')
  WHERE lat BETWEEN -1.285 AND -1.262
    AND lon BETWEEN 36.825 AND 36.855
    AND NOT ('Ngara' = ANY(landmark_aliases));

  -- ── Pangani ─────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Pangani')
  WHERE lat BETWEEN -1.278 AND -1.260
    AND lon BETWEEN 36.838 AND 36.862
    AND NOT ('Pangani' = ANY(landmark_aliases));

  -- ── Hurlingham / Upper Hill ──────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Hurlingham')
  WHERE lat BETWEEN -1.310 AND -1.285
    AND lon BETWEEN 36.780 AND 36.815
    AND NOT ('Hurlingham' = ANY(landmark_aliases));

  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Upper Hill')
  WHERE lat BETWEEN -1.306 AND -1.282
    AND lon BETWEEN 36.815 AND 36.842
    AND NOT ('Upper Hill' = ANY(landmark_aliases));

  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Upperhill')
  WHERE lat BETWEEN -1.306 AND -1.282
    AND lon BETWEEN 36.815 AND 36.842
    AND NOT ('Upperhill' = ANY(landmark_aliases));

  -- ── South B ─────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'South B')
  WHERE lat BETWEEN -1.322 AND -1.290
    AND lon BETWEEN 36.840 AND 36.878
    AND NOT ('South B' = ANY(landmark_aliases));

  -- ── South C ─────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'South C')
  WHERE lat BETWEEN -1.340 AND -1.315
    AND lon BETWEEN 36.835 AND 36.872
    AND NOT ('South C' = ANY(landmark_aliases));

  -- ── Industrial Area ──────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Industrial Area')
  WHERE lat BETWEEN -1.325 AND -1.295
    AND lon BETWEEN 36.845 AND 36.880
    AND NOT ('Industrial Area' = ANY(landmark_aliases));

  -- ── Kenyatta Market / Hazina ─────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Kenyatta Market')
  WHERE lat BETWEEN -1.328 AND -1.300
    AND lon BETWEEN 36.808 AND 36.840
    AND NOT ('Kenyatta Market' = ANY(landmark_aliases));

  -- ── Kibera ──────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Kibera')
  WHERE lat BETWEEN -1.325 AND -1.288
    AND lon BETWEEN 36.773 AND 36.820
    AND NOT ('Kibera' = ANY(landmark_aliases));

  -- ── Kawangware ──────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Kawangware')
  WHERE lat BETWEEN -1.288 AND -1.248
    AND lon BETWEEN 36.735 AND 36.780
    AND NOT ('Kawangware' = ANY(landmark_aliases));

  -- ── Dagoretti ───────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Dagoretti')
  WHERE lat BETWEEN -1.320 AND -1.265
    AND lon BETWEEN 36.705 AND 36.760
    AND NOT ('Dagoretti' = ANY(landmark_aliases));

  -- ── Langata ─────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Langata')
  WHERE lat BETWEEN -1.370 AND -1.310
    AND lon BETWEEN 36.728 AND 36.788
    AND NOT ('Langata' = ANY(landmark_aliases));

  -- ── Karen ───────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Karen')
  WHERE lat BETWEEN -1.365 AND -1.305
    AND lon BETWEEN 36.665 AND 36.730
    AND NOT ('Karen' = ANY(landmark_aliases));

  -- ── Ngong Road ──────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Ngong Road')
  WHERE lat BETWEEN -1.340 AND -1.285
    AND lon BETWEEN 36.740 AND 36.818
    AND NOT ('Ngong Road' = ANY(landmark_aliases));

  -- ── Buruburu / Buru Buru ────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Buru Buru')
  WHERE lat BETWEEN -1.305 AND -1.278
    AND lon BETWEEN 36.868 AND 36.905
    AND NOT ('Buru Buru' = ANY(landmark_aliases));

  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Buruburu')
  WHERE lat BETWEEN -1.305 AND -1.278
    AND lon BETWEEN 36.868 AND 36.905
    AND NOT ('Buruburu' = ANY(landmark_aliases));

  -- ── Donholm ─────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Donholm')
  WHERE lat BETWEEN -1.310 AND -1.280
    AND lon BETWEEN 36.892 AND 36.930
    AND NOT ('Donholm' = ANY(landmark_aliases));

  -- ── Embakasi ────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Embakasi')
  WHERE lat BETWEEN -1.338 AND -1.295
    AND lon BETWEEN 36.875 AND 36.935
    AND NOT ('Embakasi' = ANY(landmark_aliases));

  -- ── Imara Daima ─────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Imara Daima')
  WHERE lat BETWEEN -1.350 AND -1.320
    AND lon BETWEEN 36.870 AND 36.920
    AND NOT ('Imara Daima' = ANY(landmark_aliases));

  -- ── Rongai ──────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Rongai')
  WHERE lat BETWEEN -1.430 AND -1.380
    AND lon BETWEEN 36.740 AND 36.790
    AND NOT ('Rongai' = ANY(landmark_aliases));

  -- ── Thika Road (corridor) ────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Thika Road')
  WHERE lat BETWEEN -1.260 AND -1.155
    AND lon BETWEEN 36.855 AND 36.930
    AND NOT ('Thika Road' = ANY(landmark_aliases));

  -- ── Kahawa ──────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Kahawa')
  WHERE lat BETWEEN -1.210 AND -1.170
    AND lon BETWEEN 36.880 AND 36.935
    AND NOT ('Kahawa' = ANY(landmark_aliases));

  -- ── Githurai ────────────────────────────────────────────────────────────────
  UPDATE transit_stops
  SET landmark_aliases = array_append(landmark_aliases, 'Githurai')
  WHERE lat BETWEEN -1.220 AND -1.175
    AND lon BETWEEN 36.907 AND 36.960
    AND NOT ('Githurai' = ANY(landmark_aliases));

END $$;
