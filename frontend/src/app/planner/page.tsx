"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { api, RoutePlan, RouteLeg, RouteReport } from "@/lib/api";
import type { MapLeg } from "@/components/TransitMap";

const TransitMap = dynamic(() => import("@/components/TransitMap"), {
  ssr: false,
  loading: () => (
    <div className="h-80 w-full bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm">
      Loading map…
    </div>
  ),
});

const LEG_COLORS = ["#00A650", "#0066CC", "#FF6B00", "#9B59B6"];

// Quick destination suggestions for Nairobi newcomers
const SUGGESTIONS = [
  "Westlands", "Buru Buru", "Kasarani", "Rongai", "Karen", "Kibera",
  "Kawangware", "Ruaka", "Ngong", "Kayole", "Githurai 44", "Langata",
];

function LegCard({ leg, index }: { leg: RouteLeg; index: number }) {
  const color = LEG_COLORS[index % LEG_COLORS.length];
  return (
    <div className="border rounded-xl p-4 bg-white shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-white text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: color }}
        >
          Route {leg.route_number}
        </span>
        <span className="text-sm text-gray-600 font-medium">{leg.route_name}</span>
        {index > 0 && (
          <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
            Transfer
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <span className="w-5 h-5 rounded-full bg-transit-green text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">↑</span>
          <div>
            <div className="font-medium">Board at {leg.board_at}</div>
            {leg.board_stage && (
              <div className="text-xs text-gray-500">{leg.board_stage}</div>
            )}
          </div>
        </div>

        {leg.stops.length > 2 && (
          <div className="pl-7 text-xs text-gray-400">
            ↕ {leg.stops.length - 2} intermediate stops
          </div>
        )}

        <div className="flex items-start gap-2">
          <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">↓</span>
          <div className="font-medium">Alight at {leg.alight_at}</div>
        </div>
      </div>

      <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100 text-sm">
        <div>
          <span className="text-gray-500 text-xs">Fare</span>
          <div className="font-bold text-transit-green">Ksh {leg.fare_kes}</div>
        </div>
        <div>
          <span className="text-gray-500 text-xs">Est. time</span>
          <div className="font-bold">{leg.est_minutes} min</div>
        </div>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: RouteReport }) {
  const icons: Record<string, string> = {
    route_change: "🔄",
    stage_change: "📍",
    congestion: "🚦",
    flooding: "🌊",
    police_check: "🚔",
    other: "ℹ️",
  };
  return (
    <div className="flex items-start gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
      <span className="flex-shrink-0">{icons[report.report_type] ?? "ℹ️"}</span>
      <div>
        <div>{report.description}</div>
        {report.confirmed_by_conductor && (
          <span className="text-xs text-green-600 font-medium">✓ Confirmed by conductor</span>
        )}
      </div>
    </div>
  );
}

export default function PlannerPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reports, setReports] = useState<RouteReport[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [reportType, setReportType] = useState("congestion");
  const [reportDesc, setReportDesc] = useState("");
  const [reportPhone, setReportPhone] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSuccess, setReportSuccess] = useState("");

  async function search() {
    if (!from.trim() || !to.trim()) return;
    setLoading(true);
    setError("");
    setMessage("");
    setPlans([]);
    try {
      const res = await api.planRoute(from.trim(), to.trim());
      setPlans(res.plans);
      setSelectedPlan(0);
      if (res.message) setMessage(res.message);
      // Also load active alerts
      const rpts = await api.getReports();
      setReports(rpts.reports);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Route search failed");
    } finally {
      setLoading(false);
    }
  }

  async function submitReport() {
    if (!reportDesc.trim()) return;
    setReportLoading(true);
    try {
      const res = await api.submitReport({
        report_type: reportType,
        description: reportDesc.trim(),
        reporter_phone: reportPhone.trim() || undefined,
      });
      setReportSuccess(res.message);
      setReportDesc("");
      setShowReport(false);
    } catch {
      setReportSuccess("Failed to submit report. Please try again.");
    } finally {
      setReportLoading(false);
    }
  }

  // Build map legs for selected plan
  const mapLegs: MapLeg[] = (plans[selectedPlan]?.legs ?? []).map((leg, i) => ({
    routeNumber: leg.route_number,
    routeName: leg.route_name,
    boardAt: leg.board_at,
    alightAt: leg.alight_at,
    boardLat: leg.board_lat ?? undefined,
    boardLon: leg.board_lon ?? undefined,
    stops: leg.stops.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon, sequence: s.sequence })),
    color: LEG_COLORS[i % LEG_COLORS.length],
  }));

  const mapCenter: [number, number] =
    mapLegs.length > 0 && mapLegs[0].stops.length > 0
      ? [mapLegs[0].stops[0].lat, mapLegs[0].stops[0].lon]
      : [-1.2921, 36.8219];

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <h1 className="text-xl font-bold mb-1">Route Planner</h1>
      <p className="text-sm text-gray-500 mb-5">
        Find the best matatu route — direct or with one transfer
      </p>

      {/* Search inputs */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200 mb-4">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">FROM (landmark or area)</label>
            <input
              type="text"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="e.g. Westlands, CBD, Kencom"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">TO (landmark or area)</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="e.g. Buru Buru, Kasarani, Rongai"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-transit-green focus:ring-2 focus:ring-transit-green/20"
            />
          </div>

          {/* Quick suggestions */}
          <div>
            <div className="text-xs text-gray-400 mb-1.5">Popular destinations:</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setTo(s)}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-transit-green/10 hover:text-transit-green rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={search}
            disabled={loading || !from.trim() || !to.trim()}
            className="w-full bg-transit-green text-white py-3 rounded-lg font-semibold hover:bg-transit-green-dark disabled:bg-gray-400 transition-colors"
          >
            {loading ? "Searching…" : "Find Route"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {message && !error && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg px-4 py-3 text-sm mb-4">
          {message}
        </div>
      )}

      {reportSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm mb-4">
          {reportSuccess}
        </div>
      )}

      {/* Active alerts for this route */}
      {reports.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Live alerts</div>
          {reports.slice(0, 3).map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}

      {/* Results */}
      {plans.length > 0 && (
        <div className="space-y-4">
          {/* Plan selector (if multiple options) */}
          {plans.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {plans.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedPlan(i)}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm border transition-colors ${
                    i === selectedPlan
                      ? "bg-transit-green text-white border-transit-green"
                      : "bg-white border-gray-200 hover:border-transit-green"
                  }`}
                >
                  {p.transfers === 0 ? "Direct" : `${p.transfers} transfer`} · Ksh {p.total_fare_kes}
                </button>
              ))}
            </div>
          )}

          {/* Selected plan summary */}
          {plans[selectedPlan] && (
            <div className="bg-transit-green/5 border border-transit-green/20 rounded-xl p-4">
              <div className="font-semibold text-sm mb-1">{plans[selectedPlan].summary}</div>
              <div className="flex gap-4 text-sm">
                <span>
                  Total fare:{" "}
                  <strong className="text-transit-green">
                    Ksh {plans[selectedPlan].total_fare_kes}
                  </strong>
                </span>
                <span>
                  Est. time:{" "}
                  <strong>{plans[selectedPlan].total_minutes} min</strong>
                </span>
                <span>
                  {plans[selectedPlan].transfers === 0 ? (
                    <span className="text-green-600 font-medium">Direct route ✓</span>
                  ) : (
                    <span className="text-orange-600 font-medium">
                      {plans[selectedPlan].transfers} transfer
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Map */}
          <TransitMap
            center={mapCenter}
            zoom={12}
            legs={mapLegs}
            className="h-72 w-full"
          />

          {/* Step-by-step legs */}
          <div className="space-y-3">
            {plans[selectedPlan]?.legs.map((leg, i) => (
              <LegCard key={i} leg={leg} index={i} />
            ))}
          </div>

          {/* Report route issue */}
          <div className="mt-2">
            <button
              onClick={() => setShowReport(!showReport)}
              className="text-sm text-gray-500 hover:text-transit-green transition-colors underline-offset-2 hover:underline"
            >
              {showReport ? "Cancel" : "Report a route issue"}
            </button>

            {showReport && (
              <div className="mt-3 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="text-sm font-semibold">Submit a route alert</div>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-transit-green"
                >
                  <option value="route_change">Route changed</option>
                  <option value="stage_change">Stage moved</option>
                  <option value="congestion">Heavy traffic</option>
                  <option value="flooding">Flooding</option>
                  <option value="police_check">Police checkpoint</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                  value={reportDesc}
                  onChange={(e) => setReportDesc(e.target.value)}
                  placeholder="What's happening? e.g. Route 23 picking from Ngara instead of OTC due to traffic"
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-transit-green resize-none"
                />
                <input
                  type="tel"
                  value={reportPhone}
                  onChange={(e) => setReportPhone(e.target.value)}
                  placeholder="Your phone (optional, for follow-up)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-transit-green"
                />
                <button
                  onClick={submitReport}
                  disabled={reportLoading || !reportDesc.trim()}
                  className="w-full bg-orange-500 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-orange-600 disabled:bg-gray-400 transition-colors"
                >
                  {reportLoading ? "Submitting…" : "Submit Alert"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state with landmark tips */}
      {!loading && plans.length === 0 && !error && (
        <div className="bg-white rounded-xl p-6 border border-gray-200 text-center text-sm text-gray-500">
          <div className="text-3xl mb-2">🗺️</div>
          <div className="font-medium text-gray-700 mb-1">Plan your matatu journey</div>
          <div>Use landmarks: &quot;Archives&quot;, &quot;KNH&quot;, &quot;Sarit Centre&quot;</div>
          <div className="mt-2 text-xs">Supports all 135 DigitalMatatus routes</div>
        </div>
      )}
    </div>
  );
}
