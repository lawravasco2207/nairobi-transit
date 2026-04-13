"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export default function RegisterPage() {
  const [tab, setTab] = useState<"vehicle" | "conductor">("vehicle");

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <h1 className="text-xl font-bold mb-1">Join the Platform</h1>
      <p className="text-sm text-gray-500 mb-5">
        Register your matatu and conductor to start accepting cashless fares
      </p>

      {/* Tabs */}
      <div className="flex gap-0.5 bg-gray-100 rounded-lg p-1 mb-5">
        {(["vehicle", "conductor"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-center text-sm font-semibold rounded-md transition-colors ${
              tab === t
                ? "bg-white text-transit-green shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "vehicle" ? "Vehicle" : "Conductor"}
          </button>
        ))}
      </div>

      {tab === "vehicle" ? <VehicleForm /> : <ConductorForm />}
    </div>
  );
}

function VehicleForm() {
  const [plate, setPlate] = useState("");
  const [shortId, setShortId] = useState("");
  const [sacco, setSacco] = useState("");
  const [paybill, setPaybill] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; message: string } | null>(null);

  async function submit() {
    if (!plate || !shortId || !sacco || !paybill) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await api.registerVehicle(plate.toUpperCase(), shortId.toUpperCase(), sacco, paybill);
      setResult(r);
      setPlate("");
      setShortId("");
      setSacco("");
      setPaybill("");
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
        One-time setup per vehicle &mdash; you&apos;ll get a USSD code and QR link
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {result && (
        <Alert type="success">
          ✅ {result.message} &mdash; ID: <span className="font-mono text-xs">{result.id}</span>
        </Alert>
      )}

      <Field label="Number Plate" value={plate} onChange={setPlate} placeholder="e.g. KDA 123A" upper />
      <Field label="Vehicle Code" value={shortId} onChange={setShortId} placeholder="e.g. NBC43 (unique short ID)" upper maxLength={10} />
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
      setName("");
      setPhone("");
      setVehicleCode("");
      setPin("");
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

      {error && <Alert type="error">{error}</Alert>}
      {result && (
        <Alert type="success">
          ✅ {result.message} &mdash; ID: <span className="font-mono text-xs">{result.id}</span>
        </Alert>
      )}

      <Field label="Full Name" value={name} onChange={setName} placeholder="e.g. John Kamau" />
      <Field label="Phone Number" value={phone} onChange={setPhone} placeholder="+254712345678" type="tel" />
      <Field label="Vehicle Code" value={vehicleCode} onChange={setVehicleCode} placeholder="e.g. NBC43" upper maxLength={10} />
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

/* ── Shared ───── */
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

function Alert({ type, children }: { type: "error" | "success"; children: React.ReactNode }) {
  const styles =
    type === "error"
      ? "bg-red-50 text-red-500 border-red-300"
      : "bg-transit-green-light text-transit-green-dark border-green-300";
  return (
    <div className={`${styles} border rounded-lg px-4 py-3 text-sm mb-4`}>
      {children}
    </div>
  );
}
