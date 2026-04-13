"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

// Child component that imperatively re-centres the map when props change.
// MapContainer ignores center/zoom prop changes after first mount, so this is
// the correct react-leaflet pattern.
function ChangeView({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);
  return null;
}

// Fix default icon paths that break in Next.js
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

export interface MapStop {
  id?: number;
  name: string;
  lat: number;
  lon: number;
  sequence?: number;
}

export interface MapLeg {
  routeNumber: string;
  routeName: string;
  boardAt: string;
  alightAt: string;
  boardLat?: number;
  boardLon?: number;
  stops: MapStop[];
  color: string;
}

export interface LiveVehicle {
  vehicle_id: string;
  short_id: string;
  route: string;
  destination: string;
  lat: number;
  lon: number;
  updated_seconds_ago: number;
}

interface TransitMapProps {
  center?: [number, number];
  zoom?: number;
  legs?: MapLeg[];
  nearbyStops?: MapStop[];
  liveVehicles?: LiveVehicle[];
  vehiclePosition?: { lat: number; lon: number };
  destinationStop?: MapStop;
  className?: string;
}

const LEG_COLORS = ["#00A650", "#0066CC", "#FF6B00", "#9B59B6", "#E74C3C"];
const NAIROBI_CENTER: [number, number] = [-1.2921, 36.8219];

// Bus icon SVG marker
function busIcon(color: string) {
  return L.divIcon({
    html: `<div style="background:${color};color:white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)">🚌</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    className: "",
  });
}

export default function TransitMap({
  center = NAIROBI_CENTER,
  zoom = 13,
  legs = [],
  nearbyStops = [],
  liveVehicles = [],
  vehiclePosition,
  destinationStop,
  className = "h-80 w-full",
}: TransitMapProps) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className={`rounded-xl ${className}`}
      style={{ zIndex: 0 }}
    >
      <ChangeView center={center} zoom={zoom} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* ── Journey legs as coloured polylines ── */}
      {legs.map((leg, i) => {
        const color = leg.color || LEG_COLORS[i % LEG_COLORS.length];
        const positions: [number, number][] = leg.stops
          .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
          .map((s) => [s.lat, s.lon]);

        return (
          <Polyline
            key={`leg-${i}`}
            positions={positions}
            pathOptions={{ color, weight: 5, opacity: 0.85 }}
          />
        );
      })}

      {/* ── Stops along each leg ── */}
      {legs.map((leg, i) =>
        leg.stops.map((stop, j) => {
          const color = leg.color || LEG_COLORS[i % LEG_COLORS.length];
          const isBoard  = stop.name === leg.boardAt;
          const isAlight = stop.name === leg.alightAt;
          return (
            <CircleMarker
              key={`${i}-${j}-${stop.name}`}
              center={[stop.lat, stop.lon]}
              radius={isBoard || isAlight ? 9 : 5}
              pathOptions={{
                color: isBoard ? "#00A650" : isAlight ? "#E74C3C" : color,
                fillColor: isBoard ? "#00A650" : isAlight ? "#E74C3C" : "white",
                fillOpacity: 1,
                weight: 2,
              }}
            >
              <Tooltip>{stop.name}</Tooltip>
            </CircleMarker>
          );
        })
      )}

      {/* ── Boarding stage markers with route labels ── */}
      {legs.map(
        (leg, i) =>
          leg.boardLat &&
          leg.boardLon && (
            <Marker
              key={`stage-${i}`}
              position={[leg.boardLat, leg.boardLon]}
            >
              <Popup>
                <div className="text-sm font-semibold">
                  Route {leg.routeNumber} — {leg.boardAt}
                </div>
                <div className="text-xs text-gray-500">{leg.routeName}</div>
              </Popup>
            </Marker>
          )
      )}

      {/* ── Nearby stops (stage finder / planner start) ── */}
      {nearbyStops.map((stop) => (
        <CircleMarker
          key={`nearby-${stop.id ?? `${stop.lat}-${stop.lon}`}`}
          center={[stop.lat, stop.lon]}
          radius={6}
          pathOptions={{
            color: "#0066CC",
            fillColor: "#4DA6FF",
            fillOpacity: 0.9,
            weight: 2,
          }}
        >
          <Tooltip>{stop.name}</Tooltip>
        </CircleMarker>
      ))}

      {/* ── Live vehicles ── */}
      {liveVehicles.map((v) => {
        const stale = v.updated_seconds_ago > 120;
        return (
          <Marker
            key={v.vehicle_id}
            position={[v.lat, v.lon]}
            icon={busIcon(stale ? "#999" : "#00A650")}
          >
            <Popup>
              <div className="text-sm font-semibold">{v.short_id}</div>
              <div className="text-xs">{v.route}</div>
              <div className="text-xs text-gray-500">
                → {v.destination} •{" "}
                {stale
                  ? "GPS stale"
                  : `${Math.round(v.updated_seconds_ago)}s ago`}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* ── Passenger's current vehicle position (journey tracker) ── */}
      {vehiclePosition && (
        <Marker
          position={[vehiclePosition.lat, vehiclePosition.lon]}
          icon={busIcon("#FF6B00")}
        >
          <Popup>Your matatu is here</Popup>
        </Marker>
      )}

      {/* ── Destination pin ── */}
      {destinationStop && (
        <CircleMarker
          center={[destinationStop.lat, destinationStop.lon]}
          radius={12}
          pathOptions={{
            color: "#E74C3C",
            fillColor: "#E74C3C",
            fillOpacity: 0.8,
            weight: 3,
          }}
        >
          <Tooltip permanent>{destinationStop.name} (Your stop)</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
