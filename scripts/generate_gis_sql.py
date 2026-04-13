import shapefile
import sys
import re

GIS_DIR = "/home/larry/projects/nairobi-transit/GIS_DATA_2019"

def esc(s):
    """Escape a string for SQL single-quote safety."""
    return str(s).replace("'", "''")

lines = []
lines.append("-- AUTO-GENERATED from GIS_DATA_2019 shapefiles (DigitalMatatus / MIT-UoN 2019)")
lines.append("-- DO NOT EDIT BY HAND — regenerate with scripts/generate_gis_sql.py")
lines.append("")

# ──────────────────────────────────────────────────────────────────────────────
# 1. STOPS
# ──────────────────────────────────────────────────────────────────────────────
lines.append("-- ── 1. Transit Stops (all 4284 from stops.shp) ────────────────────────────")
lines.append("INSERT INTO transit_stops (external_id, name, lat, lon, geom) VALUES")

sf_stops = shapefile.Reader(f"{GIS_DIR}/stops.shp")
fn_stops = [f[0] for f in sf_stops.fields[1:]]

stop_rows = []
stop_id_to_db = {}  # external_id -> will get SERIAL id after insert

for i, sr in enumerate(sf_stops.iterShapeRecords()):
    rec = dict(zip(fn_stops, sr.record))
    external_id = esc(rec['stop_id'])
    name = esc(rec['stop_name'])
    lat = rec['stop_lat']
    lon = rec['stop_lon']

    # Validate coords (Nairobi bounding box)
    if not (-1.6 < lat < -0.9 and 36.5 < lon < 37.2):
        continue
    
    stop_rows.append(
        f"  ('{external_id}', '{name}', {lat}, {lon}, "
        f"ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326)::geography)"
    )

lines.append(",\n".join(stop_rows))
lines.append("ON CONFLICT (external_id) DO UPDATE SET")
lines.append("  name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon, geom = EXCLUDED.geom;")
lines.append("")
lines.append(f"-- Loaded {len(stop_rows)} stops")
lines.append("")

# ──────────────────────────────────────────────────────────────────────────────
# 2. ROUTES (one row per unique route_id, direction=0 = outbound/canonical)
# ──────────────────────────────────────────────────────────────────────────────
lines.append("-- ── 2. Transit Routes (136 unique routes from shapes.shp directions=0) ──")
lines.append("INSERT INTO transit_routes")
lines.append("  (external_id, route_number, route_name, origin, destination, geom)")
lines.append("VALUES")

sf_shapes = shapefile.Reader(f"{GIS_DIR}/shapes.shp")
fn_shapes = [f[0] for f in sf_shapes.fields[1:]]

# Collect one canonical shape per route_id (prefer direction=0)
routes_by_id = {}
for sr in sf_shapes.iterShapeRecords():
    rec = dict(zip(fn_shapes, sr.record))
    rid = rec['route_id']
    direction = rec['direction']
    if rid not in routes_by_id or direction == 0:
        routes_by_id[rid] = (rec, sr.shape.points)

route_rows = []
for route_id, (rec, points) in sorted(routes_by_id.items()):
    external_id = esc(rec['route_id'])
    route_number = esc(rec['route_name'])
    route_long = esc(rec['route_long'])
    headsign = esc(rec['headsign'])
    
    # origin = first word before dash in route_long, destination = headsign
    parts = rec['route_long'].split('-')
    origin = esc(parts[0].strip()) if parts else route_number
    destination = headsign

    # Build WKT linestring from points (lon lat)
    if len(points) < 2:
        continue
    pts_wkt = ",".join(f"{lon} {lat}" for lon, lat in points)
    geom_wkt = f"ST_SetSRID(ST_GeomFromText('LINESTRING({pts_wkt})'), 4326)::geography"
    
    route_rows.append(
        f"  ('{external_id}', '{route_number}', '{route_long}', '{origin}', '{destination}', {geom_wkt})"
    )

lines.append(",\n".join(route_rows))
lines.append("ON CONFLICT (external_id) DO UPDATE SET")
lines.append("  route_name = EXCLUDED.route_name, origin = EXCLUDED.origin,")
lines.append("  destination = EXCLUDED.destination, geom = EXCLUDED.geom;")
lines.append("")
lines.append(f"-- Loaded {len(route_rows)} routes")
lines.append("")

# ──────────────────────────────────────────────────────────────────────────────
# 3. ROUTE_STOPS: spatial proximity — each stop linked to routes within 80m
#    We use the stop's route_nams field (directly from the dataset) as ground truth
# ──────────────────────────────────────────────────────────────────────────────
lines.append("-- ── 3. Route-Stop links (from stop.route_ids field) ────────────────────────")
lines.append("-- Build route_stops from the embedded route_ids in each stop record.")
lines.append("-- We use a DO block to avoid hardcoding thousands of IDs.")
lines.append("DO $$")
lines.append("DECLARE")
lines.append("  v_route_id INT;")
lines.append("  v_stop_id  INT;")
lines.append("  v_seq      INT;")
lines.append("  seq_tracker JSONB := '{}'::jsonb;")
lines.append("  route_ext TEXT;")
lines.append("BEGIN")
lines.append("")

# For each stop, pull out its route_ids and link them
# We build one INSERT per (route_external_id, stop_external_id) pair
# using a helper that looks up the INT IDs
stop_route_pairs = set()

sf_stops2 = shapefile.Reader(f"{GIS_DIR}/stops.shp")
fn2 = [f[0] for f in sf_stops2.fields[1:]]

for sr in sf_stops2.iterShapeRecords():
    rec = dict(zip(fn2, sr.record))
    lat = rec['stop_lat']
    lon = rec['stop_lon']
    if not (-1.6 < lat < -0.9 and 36.5 < lon < 37.2):
        continue
    
    stop_ext = rec['stop_id']
    rids = rec['route_ids'].strip().split() if rec['route_ids'].strip() else []
    
    seen_for_stop = set()
    for rid in rids:
        if rid and rid not in seen_for_stop:
            seen_for_stop.add(rid)
            stop_route_pairs.add((rid, stop_ext))

# Emit the INSERT block using CTEs for safety
lines.append("  -- Insert route_stops from GIS stop ↔ route associations")
lines.append("  INSERT INTO route_stops (route_id, stop_id, stop_sequence, distance_from_origin)")
lines.append("  SELECT")
lines.append("    r.id AS route_id,")
lines.append("    s.id AS stop_id,")
lines.append("    ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id) AS stop_sequence,")
lines.append("    ROUND(ST_Distance(r.geom, s.geom)::numeric, 1)::float AS distance_from_origin")
lines.append("  FROM (VALUES")

pair_rows = []
for rid, sid in sorted(stop_route_pairs):
    pair_rows.append(f"    ('{esc(rid)}', '{esc(sid)}')")

lines.append(",\n".join(pair_rows))
lines.append("  ) AS src(route_ext, stop_ext)")
lines.append("  JOIN transit_routes r ON r.external_id = src.route_ext")
lines.append("  JOIN transit_stops  s ON s.external_id = src.stop_ext")
lines.append("  ON CONFLICT DO NOTHING;")
lines.append("")
lines.append("END $$;")
lines.append("")

# ──────────────────────────────────────────────────────────────────────────────
# 4. Rebuild transit_graph from route_stops
# ──────────────────────────────────────────────────────────────────────────────
lines.append("-- ── 4. Build transit graph (directed edges) ────────────────────────────────")
lines.append("INSERT INTO transit_graph (from_stop_id, to_stop_id, route_id, cost_minutes, fare_kes)")
lines.append("SELECT")
lines.append("  rs1.stop_id, rs2.stop_id, rs1.route_id,")
lines.append("  GREATEST(1, ROUND((ST_Distance(s1.geom, s2.geom) / 1000.0 / 30.0 * 60.0)::numeric, 1)::float),")
lines.append("  60  -- placeholder fare; updated by conductor per trip")
lines.append("FROM route_stops rs1")
lines.append("JOIN route_stops rs2 ON rs2.route_id = rs1.route_id AND rs2.stop_sequence = rs1.stop_sequence + 1")
lines.append("JOIN transit_stops s1 ON s1.id = rs1.stop_id")
lines.append("JOIN transit_stops s2 ON s2.id = rs2.stop_id")
lines.append("ON CONFLICT DO NOTHING;")
lines.append("")
lines.append("-- Reverse edges")
lines.append("INSERT INTO transit_graph (from_stop_id, to_stop_id, route_id, cost_minutes, fare_kes)")
lines.append("SELECT to_stop_id, from_stop_id, route_id, cost_minutes, fare_kes")
lines.append("FROM transit_graph")
lines.append("ON CONFLICT DO NOTHING;")
lines.append("")
lines.append("-- ── Done ───────────────────────────────────────────────────────────────────")

sql = "\n".join(lines)
with open("/tmp/006_seed_gis_data.sql", "w") as f:
    f.write(sql)

print(f"Generated SQL: {len(sql)} bytes, {len(stop_rows)} stops, {len(route_rows)} routes, {len(stop_route_pairs)} route-stop pairs")
