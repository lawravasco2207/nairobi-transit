"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { api, RegisterResult } from "@/lib/api";

/* ── Shared types ─────────────────────────────────────── */
interface PaymentEvent {
  event: string;
  passenger_phone: string;
  amount_kes: number;
  mpesa_ref: string;
  channel: string;
  trip_id: string;
}

interface ActiveTrip {
  phone: string;
  pin: string;
  route: string;
  dest: string;
  fare: number;
  tripId: string;
}

/* ── Top-level tabs ───────────────────────────────────── */
type CrewTab = "trip" | "fare" | "payments" | "qr" | "gps" | "register";

const TAB_LABELS: Record<CrewTab, string> = {
  trip: "Set Trip",
  fare: "Fare",
  payments: "Payments",
  qr: "QR Code",
  gps: "GPS",
  register: "Register",
};

/* ════════════════════════════════════════════════════════
   Page
════════════════════════════════════════════════════════ */
export default function CrewPage() {
  const [tab, setTab] = useState<CrewTab>("trip");
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      {/* Back link */}
      <div className="mb-4">
        <Link href="/" className="text-sm text-transit-green font-semibold hover:underline">
          ← Passenger view
        </Link>
      </div>

      <h1 className="text-xl font-bold mb-1">Crew Dashboard</h1>
      <p className="text-sm text-gray-500 mb-5">
        Conductor and driver tools — registration, trips, fares, and GPS
      </p>

      {/* Tab bar */}
      <div className="flex gap-0.5 bg-gray-100 rounded-lg p-1 mb-5 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as CrewTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-center text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
              tab === t
                ? "bg-white text-transit-green shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "trip" && (
        <SetTripTab
          onTripSet={(phone, pin, tripId, route, dest, fare) =>
            setActiveTrip({ phone, pin, tripId, route, dest, fare })
          }
        />
      )}
      {tab === "fare" && (
        <FareTab
          activeTrip={activeTrip}
          onFareUpdated={(newFare) =>
            setActiveTrip((t) => (t ? { ...t, fare: newFare } : t))
          }
        />
      )}
      {tab === "payments" && <LiveFeedTab />}
      {tab === "qr" && <QrViewTab />}
      {tab === "gps" && (
        <GpsTab phone={activeTrip?.phone ?? ""} tripId={activeTrip?.tripId ?? ""} />
      )}
      {tab === "register" && <RegisterSection />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Set Trip
════════════════════════════════════════════════════════ */
function SetTripTab({
  onTripSet,
}: {
  onTripSet?: (
    phone: string,
    pin: string,
    tripId: string,
    route: string,
    dest: string,
    fare: number
  ) => void;
}) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [route, setRoute] = useState("");
  const [dest, setDest] = useState("");
  const [fare, setFare] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    message: string;
    ussd_code: string;
    qr_url: string;
    trip_id: string;
  } | null>(null);

  async function submit() {
    if (!phone || !pin || !route || !dest || !fare) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const fareNum = parseInt(fare, 10);
      const r = await api.setTrip(phone, pin, route, dest, fareNum);
      setResult(r);
      onTripSet?.(phone, pin, r.trip_id, route, dest, fareNum);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-1">Start / Update Trip</div>
      <div className="text-xs text-gray-500 mb-4">
        Passengers will see this info before paying
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <Field label="Your Phone Number" value={phone} onChange={setPhone} placeholder="+254712345678" type="tel" />
      <Field label="PIN" value={pin} onChange={setPin} placeholder="4-digit PIN" type="password" maxLength={8} />

      <div className="border-t border-gray-200 my-5" />

      <Field label="Route" value={route} onChange={setRoute} placeholder="e.g. CBD → Kasarani" />
      <Field label="Destination" value={dest} onChange={setDest} placeholder="e.g. Kasarani Stage" />
      <Field label="Fare (KES)" value={fare} onChange={setFare} placeholder="60" type="number" />

      <button
        onClick={submit}
        disabled={loading}
        className="w-full mt-2 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark disabled:bg-gray-400 transition-colors"
      >
        {loading ? "Setting trip..." : "Set Trip"}
      </button>

      {result && (
        <div className="mt-4 space-y-3">
          <SuccessBox>✅ {result.message}</SuccessBox>
          <div className="space-y-3">
            <Row label="USSD Code" value={result.ussd_code} mono />
            <Row label="QR URL" value={result.qr_url} small />
            <Row label="Trip ID" value={result.trip_id} mono small />
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Fare Update
════════════════════════════════════════════════════════ */
function FareTab({
  activeTrip,
  onFareUpdated,
}: {
  activeTrip: ActiveTrip | null;
  onFareUpdated: (newFare: number) => void;
}) {
  const [newFare, setNewFare] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const currentFare = activeTrip?.fare ?? null;

  async function applyFare(fare: number) {
    if (!activeTrip) return;
    if (fare < 1 || fare > 9999) {
      setError("Fare must be between 1 and 9999 KES");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await api.setTrip(activeTrip.phone, activeTrip.pin, activeTrip.route, activeTrip.dest, fare);
      onFareUpdated(fare);
      setSuccess(`Fare updated to KES ${fare}`);
      setNewFare("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  if (!activeTrip) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="font-semibold text-base mb-1">Update Fare</div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700 mt-4">
          Set a trip first using the <strong>Set Trip</strong> tab, then come back here to adjust the fare.
        </div>
      </div>
    );
  }

  const adjustments = [-50, -30, -20, +20, +30, +50];

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-1">Update Fare</div>
      <div className="text-xs text-gray-500 mb-5">
        Change the fare as you pass stages — passengers who scan / dial after this will pay the new amount.
      </div>

      <div className="bg-gray-50 rounded-xl p-5 text-center mb-5">
        <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Current fare</div>
        <div className="text-5xl font-extrabold text-transit-green-dark">
          {currentFare ?? "—"}
        </div>
        <div className="text-sm text-gray-400 mt-1">KES</div>
        <div className="text-xs text-gray-400 mt-2">{activeTrip.route}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {adjustments.map((delta) => {
          const next = (currentFare ?? 0) + delta;
          const disabled = loading || next < 1 || next > 9999;
          return (
            <button
              key={delta}
              onClick={() => applyFare(next)}
              disabled={disabled}
              className={`py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 ${
                delta < 0
                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                  : "bg-green-50 text-green-700 hover:bg-green-100"
              }`}
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="number"
          value={newFare}
          onChange={(e) => setNewFare(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newFare) applyFare(parseInt(newFare, 10));
          }}
          placeholder="Enter exact fare (KES)"
          min={1}
          max={9999}
          className="flex-1 px-3 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20"
        />
        <button
          onClick={() => newFare && applyFare(parseInt(newFare, 10))}
          disabled={loading || !newFare}
          className="bg-transit-green text-white px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 flex-shrink-0"
        >
          {loading ? "…" : "Set"}
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {success && <SuccessBox>✅ {success}</SuccessBox>}

      <div className="mt-5 bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
        <strong>How to use:</strong> Tap a quick button or type a new amount. New passengers scanning your QR or dialling USSD will be charged the updated fare immediately.
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Live Payment Feed
════════════════════════════════════════════════════════ */
function LiveFeedTab() {
  const [payments, setPayments] = useState<PaymentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const totalRef = useRef(0);
  const [total, setTotal] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const addPayment = useCallback((evt: PaymentEvent) => {
    setPayments((prev) => [evt, ...prev]);
    totalRef.current += evt.amount_kes;
    setTotal(totalRef.current);
  }, []);

  useEffect(() => {
    const ws = api.connectWS(
      (data) => {
        const evt = data as PaymentEvent;
        if (evt.event === "payment_confirmed") addPayment(evt);
      },
      () => setConnected(true),
      () => {
        setConnected(false);
        setTimeout(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            setDemoMode(true);
          }
        }, 3000);
      }
    );
    wsRef.current = ws;
    return () => ws.close();
  }, [addPayment]);

  useEffect(() => {
    if (!demoMode) return;
    const phones = ["254712345678", "254798765432", "254700111222", "254711333444"];
    const channels = ["stk", "ussd"];
    const randomRef = () => "QHX" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const fares = [30, 40, 50, 60, 70, 80, 100];

    function push() {
      addPayment({
        event: "payment_confirmed",
        passenger_phone: phones[Math.floor(Math.random() * phones.length)],
        amount_kes: fares[Math.floor(Math.random() * fares.length)],
        mpesa_ref: randomRef(),
        channel: channels[Math.floor(Math.random() * channels.length)],
        trip_id: "demo",
      });
    }

    const id = setInterval(push, 8000 + Math.random() * 7000);
    push();
    return () => clearInterval(id);
  }, [demoMode, addPayment]);

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="font-semibold text-base flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                connected
                  ? "bg-transit-green animate-pulse"
                  : demoMode
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-gray-400"
              }`}
            />
            Payment Feed
          </div>
          <div className="text-xs text-gray-500">
            {connected
              ? "Connected — live updates"
              : demoMode
              ? "Demo mode — simulated payments"
              : "Disconnected"}
          </div>
        </div>
        <span className="text-2xl font-extrabold text-transit-green-dark">
          KES {total.toLocaleString()}
        </span>
      </div>

      <div className="max-h-[400px] overflow-y-auto space-y-2">
        {payments.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-4xl mb-3">📡</div>
            <div className="text-sm">
              Waiting for payments...
              <br />
              They&apos;ll appear here instantly.
            </div>
          </div>
        ) : (
          payments.map((p, i) => {
            const masked = p.passenger_phone.replace(/(\d{3})\d{6}(\d{3})/, "$1******$2");
            const time = new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
            return (
              <div
                key={`${p.mpesa_ref}-${i}`}
                className="flex items-center gap-3 bg-transit-green-light rounded-lg px-4 py-3 animate-[slideIn_0.3s_ease]"
              >
                <div className="w-10 h-10 rounded-full bg-transit-green flex items-center justify-center text-white text-lg shrink-0">
                  ✓
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{masked}</div>
                  <div className="text-xs text-gray-500">
                    {p.mpesa_ref} &middot; {p.channel.toUpperCase()} &middot; {time}
                  </div>
                </div>
                <div className="text-base font-bold text-transit-green-dark">+{p.amount_kes}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   QR View
════════════════════════════════════════════════════════ */
function QrViewTab() {
  const [code, setCode] = useState("");
  const [qrData, setQrData] = useState<{
    qr_image_base64: string;
    ussd_fallback: string;
    route: string;
    fare_kes: number;
  } | null>(null);
  const [error, setError] = useState("");

  function getQrLookupMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "Failed";
    if (message.includes("No active trip for this vehicle")) {
      return "Vehicle found, but there is no active trip yet. Open the Trip Setup tab, start the current route, then generate the QR again.";
    }
    return message;
  }

  async function loadQR() {
    if (!code.trim()) return;
    setError("");
    try {
      const data = await api.getTrip(code.trim().toUpperCase());
      setQrData(data);
    } catch (e: unknown) {
      setError(getQrLookupMessage(e));
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-1">Vehicle QR Code</div>
      <div className="text-xs text-gray-500 mb-4">Print this and stick inside the matatu</div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && loadQR()}
        placeholder="Vehicle Code (e.g. NCH23)"
        className="w-full px-3 py-3 border border-gray-200 rounded-lg text-base uppercase tracking-wide font-semibold focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20 mb-3"
      />
      <button
        onClick={loadQR}
        className="border border-transit-green text-transit-green px-4 py-2 rounded-lg text-sm font-semibold hover:bg-transit-green-light transition-colors mb-5"
      >
        Generate QR
      </button>

      {qrData && (
        <div className="flex flex-col items-center border-2 border-dashed border-gray-200 rounded-xl p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrData.qr_image_base64} alt="QR Code" className="w-48 h-48 rounded-lg" />
          <div className="mt-3 text-xl font-bold text-transit-green-dark tracking-wide">
            {qrData.ussd_fallback}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {qrData.route} &middot; KES {qrData.fare_kes}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   GPS Tracking
════════════════════════════════════════════════════════ */
function GpsTab({ phone, tripId }: { phone: string; tripId: string }) {
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState("");
  const [pings, setPings] = useState(0);
  const [error, setError] = useState("");
  const [manualPhone, setManualPhone] = useState(phone);
  const [manualTripId, setManualTripId] = useState(tripId);
  const [prevPhone, setPrevPhone] = useState(phone);
  const [prevTripId, setPrevTripId] = useState(tripId);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (phone !== prevPhone) {
    setPrevPhone(phone);
    setManualPhone(phone);
  }
  if (tripId !== prevTripId) {
    setPrevTripId(tripId);
    setManualTripId(tripId);
  }

  function sendPing(p: string, t: string) {
    if (!navigator.geolocation) {
      setError("Geolocation not available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.sendGpsPing(p, t, pos.coords.latitude, pos.coords.longitude, pos.coords.heading ?? undefined);
          setPings((n) => n + 1);
          setStatus(`Last ping: ${new Date().toLocaleTimeString()} · ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
          setError("");
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Ping failed");
        }
      },
      (err) => setError(`Location error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function startTracking() {
    if (!manualPhone.trim() || !manualTripId.trim()) {
      setError("Set a trip first (or enter phone + trip ID manually).");
      return;
    }
    setTracking(true);
    setError("");
    setPings(0);
    sendPing(manualPhone, manualTripId);
    intervalRef.current = setInterval(() => sendPing(manualPhone, manualTripId), 30_000);
  }

  function stopTracking() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setTracking(false);
    setStatus("");
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-1">GPS Location Sharing</div>
      <div className="text-xs text-gray-500 mb-4">
        Share your location every 30s so passengers can track their matatu
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {!phone && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm mb-4 text-yellow-700">
          Set a trip first, or enter credentials manually below.
        </div>
      )}

      <Field label="Phone Number" value={manualPhone} onChange={setManualPhone} placeholder="+254712345678" type="tel" />
      <Field label="Trip ID" value={manualTripId} onChange={setManualTripId} placeholder="Trip UUID (from Set Trip)" />

      <div className="flex items-center gap-2 mt-3">
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${tracking ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
        <span className="text-sm text-gray-600">
          {tracking ? `Sharing location — ${pings} ping${pings !== 1 ? "s" : ""} sent` : "Not sharing"}
        </span>
      </div>
      {status && <div className="text-xs text-gray-400 mt-1 pl-5">{status}</div>}

      <div className="flex gap-3 mt-4">
        {!tracking ? (
          <button
            onClick={startTracking}
            className="flex-1 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark transition-colors"
          >
            📍 Start Sharing
          </button>
        ) : (
          <button
            onClick={stopTracking}
            className="flex-1 bg-red-500 text-white py-3 rounded-lg font-semibold hover:bg-red-600 transition-colors"
          >
            Stop Sharing
          </button>
        )}
      </div>

      <div className="mt-4 bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
        <div className="font-semibold text-gray-700 mb-1">How it works</div>
        <div>
          Your device sends its GPS coordinates every 30 seconds. Passengers can see your matatu&apos;s
          position on the Live Map and in their Journey Tracker. Location sharing stops automatically
          when you close this tab.
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Register (vehicle + conductor)
════════════════════════════════════════════════════════ */
function RegisterSection() {
  const [sub, setSub] = useState<"vehicle" | "conductor">("vehicle");

  return (
    <div>
      <div className="flex gap-0.5 bg-gray-100 rounded-lg p-1 mb-5">
        {(["vehicle", "conductor"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSub(t)}
            className={`flex-1 py-2.5 text-center text-sm font-semibold rounded-md transition-colors ${
              sub === t ? "bg-white text-transit-green shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "vehicle" ? "Vehicle" : "Conductor"}
          </button>
        ))}
      </div>
      {sub === "vehicle" ? <VehicleForm /> : <ConductorForm />}
    </div>
  );
}

function VehicleForm() {
  const [plate, setPlate] = useState("");
  const [sacco, setSacco] = useState("");
  const [paybill, setPaybill] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RegisterResult | null>(null);

  async function submit() {
    if (!plate || !sacco || !paybill) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await api.registerVehicle(plate.toUpperCase(), sacco, paybill);
      setResult(r);
      setPlate(""); setSacco(""); setPaybill("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-1">Register Matatu</div>
      <div className="text-xs text-gray-500 mb-4">
        One-time setup per vehicle — we&apos;ll assign the vehicle code and generate the USSD link for you
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {result && (
        <div className="space-y-3 mb-4">
          <SuccessBox>✅ {result.message} — ID: <span className="font-mono text-xs">{result.id}</span></SuccessBox>
          <Card title="Assigned Access Codes">
            <Row label="Vehicle Code" value={result.shortId ?? "Pending"} mono />
            <Row label="USSD Code" value={result.ussdCode ?? "Pending"} mono />
          </Card>
        </div>
      )}

      <Field label="Number Plate" value={plate} onChange={setPlate} placeholder="e.g. KDA 123A" upper />
      <div className="text-xs text-gray-500 -mt-2 mb-4">
        Vehicle codes follow our standard format and are generated automatically from the registration details.
      </div>
      <Field label="SACCO Name" value={sacco} onChange={setSacco} placeholder="e.g. City Hoppa SACCO" />
      <Field label="SACCO Paybill Number" value={paybill} onChange={setPaybill} placeholder="e.g. 123456" />

      <button
        onClick={submit}
        disabled={loading}
        className="w-full mt-2 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark disabled:bg-gray-400 transition-colors"
      >
        {loading ? "Registering..." : "Register Vehicle"}
      </button>
    </div>
  );
}

function ConductorForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleCode, setVehicleCode] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; message: string } | null>(null);

  async function submit() {
    if (!name || !phone || !vehicleCode || !pin) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await api.registerConductor(phone, name, vehicleCode.toUpperCase(), pin);
      setResult(r);
      setName(""); setPhone(""); setVehicleCode(""); setPin("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-1">Register Conductor</div>
      <div className="text-xs text-gray-500 mb-4">
        Link yourself to a registered vehicle to start managing trips
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {result && <SuccessBox>✅ {result.message} — ID: <span className="font-mono text-xs">{result.id}</span></SuccessBox>}

      <Field label="Full Name" value={name} onChange={setName} placeholder="e.g. John Kamau" />
      <Field label="Phone Number" value={phone} onChange={setPhone} placeholder="+254712345678" type="tel" />
      <Field label="Vehicle Code" value={vehicleCode} onChange={setVehicleCode} placeholder="e.g. NCH23" upper maxLength={10} />
      <Field label="PIN (4+ digits)" value={pin} onChange={setPin} placeholder="Enter a secure PIN" type="password" maxLength={8} />

      <button
        onClick={submit}
        disabled={loading}
        className="w-full mt-2 bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark disabled:bg-gray-400 transition-colors"
      >
        {loading ? "Registering..." : "Register Conductor"}
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Shared Components
════════════════════════════════════════════════════════ */
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  upper,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  upper?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-3 py-3 border border-gray-200 rounded-lg text-base focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20 ${
          upper ? "uppercase tracking-wide font-semibold" : ""
        }`}
      />
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span
        className={`font-semibold ${small ? "text-xs" : "text-sm"} ${mono ? "font-mono" : ""} break-all text-right max-w-[60%]`}
      >
        {value}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <div className="font-semibold text-base mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 text-red-500 border border-red-300 rounded-lg px-4 py-3 text-sm mb-4">
      {children}
    </div>
  );
}

function SuccessBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-transit-green-light text-transit-green-dark border border-green-300 rounded-lg px-4 py-3 text-sm mb-4">
      {children}
    </div>
  );
}
