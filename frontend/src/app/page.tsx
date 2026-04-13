"use client";

import { useState } from "react";
import Link from "next/link";
import { api, TripInfo } from "@/lib/api";

export default function PayPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [trip, setTrip] = useState<TripInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentId, setPaymentId] = useState("");

  async function lookupTrip() {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getTrip(code.trim().toUpperCase());
      setTrip(data);
      setStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  async function pay() {
    if (!phone.trim() || !trip) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.initiatePayment(trip.vehicle_short_id, phone.trim());
      setPaymentId(result.payment_id);
      setStep(3);
      // Simulate confirmation for demo
      setTimeout(() => setStep(4), 5000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep(1);
    setCode("");
    setPhone("");
    setTrip(null);
    setError("");
    setPaymentId("");
  }

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <h1 className="text-xl font-bold mb-1">Pay Your Fare</h1>
      <p className="text-sm text-gray-500 mb-5">
        Scan the QR code on the matatu or enter the vehicle code
      </p>

      {/* Quick links */}
      <div className="flex gap-2 mb-4">
        <Link
          href="/planner"
          className="flex-1 text-center text-xs bg-white border border-gray-200 rounded-lg py-2 text-gray-600 hover:border-transit-green hover:text-transit-green transition-colors font-medium"
        >
          🗺️ Plan Route
        </Link>
        <Link
          href="/map"
          className="flex-1 text-center text-xs bg-white border border-gray-200 rounded-lg py-2 text-gray-600 hover:border-transit-green hover:text-transit-green transition-colors font-medium"
        >
          📍 Live Map
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 text-red-500 border border-red-300 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Step 1: Vehicle code */}
      {step === 1 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="font-semibold text-base mb-1">Vehicle Code</div>
          <div className="text-xs text-gray-500 mb-4">
            Found on the sticker inside the matatu
          </div>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && lookupTrip()}
            placeholder="e.g. NBC43"
            maxLength={10}
            className="w-full px-3 py-3 border border-gray-200 rounded-lg text-xl text-center font-bold tracking-widest uppercase focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20"
          />
          <button
            onClick={lookupTrip}
            disabled={loading}
            className="w-full mt-4 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark disabled:bg-gray-400 transition-colors"
          >
            {loading ? "Looking up..." : "Find Trip"}
          </button>
        </div>
      )}

      {/* Step 2: Trip info + phone */}
      {step === 2 && trip && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
          <div className="space-y-3 mb-4">
            <Row label="Route" value={trip.route} />
            <Row label="Destination" value={trip.destination} />
            <Row label="Vehicle" value={trip.vehicle_short_id} />
            <Row label="USSD Fallback" value={trip.ussd_fallback} />
          </div>

          <div className="flex items-center justify-center bg-transit-green-light rounded-xl py-5 mb-4">
            <span className="text-base font-semibold text-transit-green mr-1">
              KES
            </span>
            <span className="text-4xl font-extrabold text-transit-green-dark">
              {trip.fare_kes}
            </span>
          </div>

          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Your Safaricom Number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pay()}
            placeholder="0712 345 678"
            maxLength={13}
            className="w-full px-3 py-3 border border-gray-200 rounded-lg text-base focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20"
          />

          <button
            onClick={pay}
            disabled={loading}
            className="w-full mt-4 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark disabled:bg-gray-400 transition-colors"
          >
            {loading ? "Sending to M-Pesa..." : "Pay Now"}
          </button>
          <button
            onClick={reset}
            className="w-full mt-2 bg-transit-green-light text-transit-green-dark py-3 rounded-lg font-semibold hover:bg-green-200 transition-colors"
          >
            &larr; Change Vehicle
          </button>
        </div>
      )}

      {/* Step 3: Waiting */}
      {step === 3 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 text-center">
          <div className="text-5xl mb-4">📱</div>
          <h3 className="text-lg font-bold mb-2">Check Your Phone</h3>
          <p className="text-sm text-gray-500 mb-4">
            Enter your M-Pesa PIN when prompted.
            <br />
            Do not close this page.
          </p>
          <div className="bg-blue-50 text-blue-800 border border-blue-300 rounded-lg px-4 py-3 text-sm inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-transit-green animate-pulse" />
            Waiting for payment confirmation...
          </div>
          {paymentId && (
            <p className="text-xs text-gray-400 mt-2">
              Payment ID: {paymentId}
            </p>
          )}
        </div>
      )}

      {/* Step 4: Success */}
      {step === 4 && trip && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 text-center">
          <div className="text-6xl mb-3">✅</div>
          <h3 className="text-lg font-bold text-transit-green-dark mb-2">
            Fare Paid!
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Your receipt has been sent via SMS.
          </p>
          <div className="text-left space-y-3 mb-4">
            <Row label="Amount" value={`KES ${trip.fare_kes}`} />
            <Row label="Route" value={trip.route} />
            <Row
              label="M-Pesa Ref"
              value={`QHX${Math.random().toString(36).slice(2, 8).toUpperCase()}`}
            />
          </div>
          {paymentId && (
            <Link
              href={`/journey/${paymentId}`}
              className="w-full mb-3 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark transition-colors flex items-center justify-center gap-2"
            >
              📍 Track My Journey
            </Link>
          )}
          <button
            onClick={reset}
            className="w-full mt-2 bg-transit-green-light text-transit-green-dark py-3 rounded-lg font-semibold hover:bg-green-200 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
