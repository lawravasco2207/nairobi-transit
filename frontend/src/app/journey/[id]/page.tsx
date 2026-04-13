"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { api, JourneyInfo } from "@/lib/api";
import type { MapStop } from "@/components/TransitMap";

const TransitMap = dynamic(() => import("@/components/TransitMap"), {
  ssr: false,
  loading: () => (
    <div className="h-64 w-full bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm">
      Loading map…
    </div>
  ),
});

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    tracking:        { label: "Live Tracking", class: "bg-green-100 text-green-700" },
    payment_pending: { label: "Payment Pending", class: "bg-yellow-100 text-yellow-700" },
    arrived:         { label: "Arrived", class: "bg-gray-100 text-gray-600" },
  };
  const s = map[status] ?? map.tracking;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.class}`}>
      {s.label}
    </span>
  );
}

export default function JourneyPage() {
  const params = useParams();
  const paymentId = params.id as string;

  const [journey, setJourney] = useState<JourneyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchJourney = useCallback(async () => {
    if (!paymentId) return;
    try {
      const data = await api.getJourney(paymentId);
      setJourney(data);
      setLastUpdate(new Date());
      setError("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load journey");
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    fetchJourney();
    // Poll every 30 seconds to get updated vehicle position
    const interval = setInterval(fetchJourney, 30_000);
    return () => clearInterval(interval);
  }, [fetchJourney]);

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center text-gray-500">
        <div className="text-3xl mb-3 animate-pulse">🚌</div>
        <div>Loading your journey…</div>
      </div>
    );
  }

  if (error || !journey) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">❌</div>
          <div className="font-medium text-gray-700">Journey not found</div>
          <div className="text-sm text-gray-500 mt-1">{error}</div>
        </div>
      </div>
    );
  }

  const hasVehicleLocation =
    journey.vehicle_lat !== null && journey.vehicle_lon !== null;

  const destinationStop: MapStop | undefined = journey.route_stops.length > 0
    ? {
        name: journey.destination,
        lat: journey.route_stops[journey.route_stops.length - 1].lat,
        lon: journey.route_stops[journey.route_stops.length - 1].lon,
      }
    : undefined;

  const mapCenter: [number, number] = hasVehicleLocation
    ? [journey.vehicle_lat!, journey.vehicle_lon!]
    : destinationStop
    ? [destinationStop.lat, destinationStop.lon]
    : [-1.2921, 36.8219];

  const vehiclePosition = hasVehicleLocation
    ? { lat: journey.vehicle_lat!, lon: journey.vehicle_lon! }
    : undefined;

  const nearbyStops: MapStop[] = journey.route_stops.map((s) => ({
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    sequence: s.sequence,
  }));

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-xl bg-transit-green/10 flex items-center justify-center text-2xl flex-shrink-0">
          🚌
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">Your Journey</h1>
            <StatusBadge status={journey.status} />
          </div>
          <div className="text-sm text-gray-500">{journey.route}</div>
        </div>
      </div>

      {/* Journey summary card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm mb-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Destination</span>
          <span className="font-semibold">{journey.destination}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Fare paid</span>
          <span className="font-semibold text-transit-green">Ksh {journey.fare_kes}</span>
        </div>
        {hasVehicleLocation && journey.vehicle_updated_seconds_ago !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">GPS updated</span>
            <span className="font-medium">
              {journey.vehicle_updated_seconds_ago < 60
                ? `${journey.vehicle_updated_seconds_ago}s ago`
                : `${Math.round(journey.vehicle_updated_seconds_ago / 60)}m ago`}
            </span>
          </div>
        )}
      </div>

      {/* Status messages */}
      {journey.status === "payment_pending" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-700 mb-4">
          <div className="font-semibold mb-1">Payment processing</div>
          <div>Your M-Pesa payment is being confirmed. Tracking will start shortly.</div>
        </div>
      )}

      {/* Map */}
      <div className="mb-4">
        <TransitMap
          center={mapCenter}
          zoom={14}
          nearbyStops={nearbyStops}
          vehiclePosition={vehiclePosition}
          destinationStop={destinationStop}
          className="h-64 w-full"
        />
      </div>

      {/* Stops along route */}
      {journey.route_stops.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Stops on this route
          </div>
          <div className="space-y-2">
            {journey.route_stops.map((stop, i) => {
              const isDest = stop.name === journey.destination;
              return (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                      isDest
                        ? "bg-red-500 text-white"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {isDest ? "★" : i + 1}
                  </div>
                  <span
                    className={isDest ? "font-bold text-red-600" : "text-gray-700"}
                  >
                    {stop.name}
                    {isDest && " ← Your stop"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No GPS fallback */}
      {!hasVehicleLocation && journey.status === "tracking" && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700 mb-4">
          <div className="font-semibold mb-1">Waiting for vehicle GPS</div>
          <div>
            Your matatu&apos;s location will appear on the map once the conductor enables GPS sharing.
            This page auto-refreshes every 30 seconds.
          </div>
        </div>
      )}

      {/* Refresh note */}
      <div className="text-xs text-gray-400 text-center">
        Auto-refreshes every 30s
        {lastUpdate && ` · Last updated ${lastUpdate.toLocaleTimeString()}`}
      </div>
    </div>
  );
}
