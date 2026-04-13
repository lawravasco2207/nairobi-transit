"use client";

import { useState, useEffect } from "react";
import { api, EnvStatus } from "@/lib/api";

export default function SettingsPage() {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getEnvStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  function refresh() {
    setLoading(true);
    setError("");
    api
      .getEnvStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Environment &amp; Settings</h1>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-sm text-transit-green font-semibold hover:underline disabled:text-gray-400"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Server configuration and service connection status
      </p>

      {error && (
        <div className="bg-red-50 text-red-500 border border-red-300 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {loading && !status && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-3xl mb-2">⏳</div>
          <div className="text-sm">Connecting to server...</div>
        </div>
      )}

      {status && (
        <div className="space-y-4">
          {/* Server */}
          <Card title="Server">
            <Row label="Host" value={status.server.host} />
            <Row label="Port" value={String(status.server.port)} />
          </Card>

          {/* Connections */}
          <Card title="Service Connections">
            <StatusRow label="PostgreSQL Database" ok={status.database_connected} />
            <StatusRow label="Redis Cache" ok={status.redis_connected} />
            <StatusRow label="Daraja (M-Pesa)" ok={status.daraja_configured} />
            <StatusRow label="Africa&apos;s Talking" ok={status.at_configured} />
          </Card>

          {/* URLs */}
          <Card title="Configured URLs">
            <Row label="Daraja API" value={status.daraja_base_url} />
            <Row label="AT Username" value={status.at_username} />
            <Row label="QR Base URL" value={status.qr_base_url} />
            <Row label="Callback URL" value={status.callback_url} />
          </Card>

          {/* Client env */}
          <Card title="Frontend Configuration">
            <Row
              label="NEXT_PUBLIC_API_URL"
              value={process.env.NEXT_PUBLIC_API_URL || "(not set — using default)"}
            />
          </Card>
        </div>
      )}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-sm font-semibold break-all text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
          ok ? "text-transit-green" : "text-red-500"
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${ok ? "bg-transit-green" : "bg-red-500"}`} />
        {ok ? "Connected" : "Not configured"}
      </span>
    </div>
  );
}
