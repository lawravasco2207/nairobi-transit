"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { api, LiveVehicle, NearbyStop } from "@/lib/api";

const TransitMap = dynamic(() => import("@/components/TransitMap"), {
  ssr: false,
  loading: () => (
    <div className="h-96 w-full bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm">
      Loading map…
    </div>
  ),
});

function VehicleCard({ vehicle }: { vehicle: LiveVehicle }) {
  const stale = vehicle.updated_seconds_ago > 120;
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0 ${
          stale ? "bg-gray-100" : "bg-transit-green/10"
        }`}
      >
        🚌
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm">{vehicle.short_id}</span>
          <span className="text-xs text-gray-500 truncate">{vehicle.route}</span>
        </div>
        <div className="text-xs text-gray-400">
          → {vehicle.destination}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div
          className={`text-xs font-medium ${
            stale ? "text-gray-400" : "text-transit-green"
          }`}
        >
          {stale
            ? "GPS stale"
            : vehicle.updated_seconds_ago < 60
            ? `${Math.round(vehicle.updated_seconds_ago)}s ago`
            : `${Math.round(vehicle.updated_seconds_ago / 60)}m ago`}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {vehicle.lat.toFixed(4)}, {vehicle.lon.toFixed(4)}
        </div>
      </div>
    </div>
  );
}

export default function LiveMapPage() {
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [nearbyStops, setNearbyStops] = useState<NearbyStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationError, setLocationError] = useState("");
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [placeSearch, setPlaceSearch] = useState("");
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  const fetchVehicles = useCallback(async () => {
    try {
      const data = await api.getLiveVehicles();
      setVehicles(data.vehicles);
      setLastRefresh(new Date());
    } catch {
      // silent – stale data is fine for the map
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchVehicles();
    const interval = setInterval(fetchVehicles, 30_000);
    return () => clearInterval(interval);
  }, [fetchVehicles]);

  // Get user's location for nearby stops
  function getLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Geolocation not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        setLocationLabel(`GPS · ${lat.toFixed(4)}, ${lon.toFixed(4)} · ±${Math.round(accuracy)}m`);
        // Accuracy > 500 m means the device has no real GPS and is using IP/WiFi
        // positioning, which can be kilometres off. Refuse to use it.
        if (accuracy > 500) {
          setLocationError(
            `GPS accuracy is only ±${Math.round(accuracy)}m — your device is guessing your location from your IP address, not real GPS. Use the place search above instead.`
          );
          return;
        }
        setUserLocation({ lat, lon });
        try {
          const data = await api.getNearbyStops(lat, lon, 2000);
          setNearbyStops(data.stops);
          if (data.stops.length === 0) {
            setLocationError("No stops found within 2km of your GPS position.");
          }
        } catch {
          setLocationError("Could not fetch nearby stops.");
        }
      },
      (err) => {
        if (err.code === err.TIMEOUT) {
          setLocationError("Location timed out. Try the place search below.");
        } else if (err.code === err.PERMISSION_DENIED) {
          setLocationError("Location access denied. Use the place search below instead.");
        } else {
          setLocationError("Could not determine your location. Use the place search below.");
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }

  // Resolve a place name to coordinates, then fetch nearby stops
  async function searchNearPlace(e: React.FormEvent) {
    e.preventDefault();
    const q = placeSearch.trim();
    if (!q) return;
    setLocationError("");
    setSearchingPlace(true);
    try {
      const { stops } = await api.searchStops(q);
      if (stops.length === 0) {
        setLocationError(`No stops found matching "${q}". Try a stage name like Thika Bus Station, Githurai, Kasarani.`);
        return;
      }
      // Use the first matching stop as the anchor point
      const anchor = stops[0];
      setUserLocation({ lat: anchor.lat, lon: anchor.lon });
      setLocationLabel(`Near "${anchor.name}"`);
      const data = await api.getNearbyStops(anchor.lat, anchor.lon, 2000);
      setNearbyStops(data.stops);
      if (data.stops.length === 0) {
        setLocationError(`No stops found within 2km of ${anchor.name}.`);
      }
    } catch {
      setLocationError("Search failed. Check your connection and try again.");
    } finally {
      setSearchingPlace(false);
    }
  }

  const mapCenter: [number, number] =
    userLocation
      ? [userLocation.lat, userLocation.lon]
      : vehicles.length > 0
      ? [vehicles[0].lat, vehicles[0].lon]
      : [-1.2921, 36.8219];

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Live Vehicle Map</h1>
        <button
          onClick={fetchVehicles}
          className="text-sm text-transit-green hover:underline"
        >
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Real-time matatu positions from active conductors
      </p>

      {/* Stats bar */}
      <div className="flex gap-4 text-sm mb-4">
        <div className="bg-transit-green/10 text-transit-green rounded-lg px-3 py-1.5 font-semibold">
          {vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""} live
        </div>
        {lastRefresh && (
          <div className="text-gray-400 flex items-center text-xs">
            Updated {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="mb-4">
        <TransitMap
          center={mapCenter}
          zoom={userLocation ? 14 : 12}
          liveVehicles={vehicles}
          nearbyStops={nearbyStops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }))}
          className="h-96 w-full"
        />
      </div>

      {/* Find stops near a place */}
      <div className="mb-3">
        <form onSubmit={searchNearPlace} className="flex gap-2">
          <input
            type="text"
            value={placeSearch}
            onChange={(e) => setPlaceSearch(e.target.value)}
            placeholder="e.g. Thika Bus Station, Githurai, Kasarani…"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-transit-green"
          />
          <button
            type="submit"
            disabled={searchingPlace || !placeSearch.trim()}
            className="bg-transit-green text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 flex-shrink-0"
          >
            {searchingPlace ? "…" : "Search"}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-1 px-1">Find stops within 2km of any stage or area name</p>
      </div>

      {/* GPS fallback */}
      <div className="mb-4">
        <button
          onClick={getLocation}
          className="w-full bg-white border border-gray-200 text-gray-500 py-2 rounded-xl text-xs font-medium hover:border-transit-green hover:text-transit-green transition-colors flex items-center justify-center gap-2"
        >
          <span>📍</span> Use device GPS instead
        </button>
        {locationLabel && (
          <div className="mt-1.5 text-xs text-gray-400 text-center">{locationLabel}</div>
        )}
        {locationError && (
          <div className="mt-1.5 text-xs text-red-500">{locationError}</div>
        )}
      </div>

      {/* Nearby stops list */}
      {nearbyStops.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Nearby stops
          </div>
          <div className="space-y-2">
            {nearbyStops.map((stop) => (
              <div
                key={stop.id}
                className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm flex items-center gap-3"
              >
                <span className="text-blue-500 flex-shrink-0">📍</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{stop.name}</div>
                  {stop.stage_name && stop.stage_name !== stop.name && (
                    <div className="text-xs text-gray-500">{stop.stage_name}</div>
                  )}
                </div>
                <div className="text-xs text-gray-400 flex-shrink-0">
                  {stop.distance_m < 1000
                    ? `${Math.round(stop.distance_m)}m`
                    : `${(stop.distance_m / 1000).toFixed(1)}km`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vehicle list */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Active matatus
        </div>
        {loading ? (
          <div className="text-center text-gray-400 text-sm py-8">Loading live vehicles…</div>
        ) : vehicles.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
            <div className="text-3xl mb-2">🚌</div>
            <div className="font-medium text-gray-700 mb-1">No active vehicles right now</div>
            <div>Vehicles appear here when conductors start a trip and share their location.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {vehicles.map((v) => (
              <VehicleCard key={v.vehicle_id} vehicle={v} />
            ))}
          </div>
        )}
      </div>

      {/* How it works note */}
      <div className="mt-6 bg-gray-50 rounded-xl p-4 text-xs text-gray-500 border border-gray-100">
        <div className="font-semibold text-gray-700 mb-1">How live tracking works</div>
        <div>
          Conductors share their GPS location every 30 seconds via the Conductor Dashboard.
          Vehicles disappear from the map if GPS hasn&apos;t updated in 3 minutes.
        </div>
      </div>
    </div>
  );
}
