const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const HEADERS: Record<string, string> = {};

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface TripInfo {
  vehicle_short_id: string;
  route: string;
  destination: string;
  fare_kes: number;
  qr_image_base64: string;
  ussd_fallback: string;
}

export interface SetTripResult {
  success: boolean;
  trip_id: string;
  ussd_code: string;
  qr_url: string;
  message: string;
}

export interface PaymentResult {
  success: boolean;
  message: string;
  payment_id: string;
}

export interface RegisterResult {
  success: boolean;
  id: string;
  message: string;
}

export interface EnvStatus {
  server: { host: string; port: number };
  database_connected: boolean;
  redis_connected: boolean;
  daraja_configured: boolean;
  daraja_base_url: string;
  at_configured: boolean;
  at_username: string;
  qr_base_url: string;
  callback_url: string;
}

export const api = {
  async getTrip(vehicleShortId: string): Promise<TripInfo> {
    const res = await fetch(`${API_BASE}/api/qr/${encodeURIComponent(vehicleShortId)}`, {
      headers: HEADERS,
    });
    return handleResponse<TripInfo>(res);
  },

  async initiatePayment(vehicleShortId: string, passengerPhone: string): Promise<PaymentResult> {
    const res = await fetch(`${API_BASE}/api/pay/qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ vehicle_short_id: vehicleShortId, passenger_phone: passengerPhone }),
    });
    return handleResponse<PaymentResult>(res);
  },

  async setTrip(phone: string, pin: string, route: string, destination: string, fareAmount: number): Promise<SetTripResult> {
    const res = await fetch(`${API_BASE}/api/conductor/trip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ auth: { phone, pin }, trip: { route, destination, fare_amount: fareAmount } }),
    });
    return handleResponse<SetTripResult>(res);
  },

  async registerVehicle(plate: string, shortId: string, saccoName: string, paybillNo: string): Promise<RegisterResult> {
    const res = await fetch(`${API_BASE}/api/vehicles/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ plate, short_id: shortId, sacco_name: saccoName, paybill_no: paybillNo }),
    });
    return handleResponse<RegisterResult>(res);
  },

  async registerConductor(phone: string, name: string, vehicleShortId: string, pin: string): Promise<RegisterResult> {
    const res = await fetch(`${API_BASE}/api/conductors/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ phone, name, vehicle_short_id: vehicleShortId, pin }),
    });
    return handleResponse<RegisterResult>(res);
  },

  async getEnvStatus(): Promise<EnvStatus> {
    const res = await fetch(`${API_BASE}/api/settings`, {
      headers: HEADERS,
    });
    return handleResponse<EnvStatus>(res);
  },

  connectWS(onMessage: (data: unknown) => void, onOpen: () => void, onClose: () => void): WebSocket {
    const wsBase = API_BASE.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/api/conductor/ws`);
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onopen = onOpen;
    ws.onclose = onClose;
    ws.onerror = () => ws.close();
    return ws;
  },

  // ── Transit / GIS ────────────────────────────────────────────────────────

  async getNearbyStops(lat: number, lon: number, radiusM = 2000): Promise<{ stops: NearbyStop[] }> {
    const res = await fetch(
      `${API_BASE}/api/transit/stops/nearby?lat=${lat}&lon=${lon}&radius_m=${radiusM}`,
      { headers: HEADERS },
    );
    return handleResponse<{ stops: NearbyStop[] }>(res);
  },

  async searchStops(q: string): Promise<{ stops: TransitStop[] }> {
    const res = await fetch(
      `${API_BASE}/api/transit/stops/search?q=${encodeURIComponent(q)}`,
      { headers: HEADERS },
    );
    return handleResponse<{ stops: TransitStop[] }>(res);
  },

  async planRoute(from: string, to: string): Promise<RoutePlanResponse> {
    const res = await fetch(
      `${API_BASE}/api/transit/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: HEADERS },
    );
    return handleResponse<RoutePlanResponse>(res);
  },

  async findStage(destination: string): Promise<StageFindResponse> {
    const res = await fetch(
      `${API_BASE}/api/transit/stages/find?destination=${encodeURIComponent(destination)}`,
      { headers: HEADERS },
    );
    return handleResponse<StageFindResponse>(res);
  },

  async getLiveVehicles(): Promise<{ vehicles: LiveVehicle[] }> {
    const res = await fetch(`${API_BASE}/api/transit/vehicles/live`, { headers: HEADERS });
    return handleResponse<{ vehicles: LiveVehicle[] }>(res);
  },

  async getJourney(paymentId: string): Promise<JourneyInfo> {
    const res = await fetch(`${API_BASE}/api/journey/${paymentId}`, { headers: HEADERS });
    return handleResponse<JourneyInfo>(res);
  },

  async submitReport(payload: {
    report_type: string;
    route_id?: number;
    stop_id?: number;
    description: string;
    reporter_phone?: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/api/transit/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify(payload),
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getReports(): Promise<{ reports: RouteReport[] }> {
    const res = await fetch(`${API_BASE}/api/transit/reports`, { headers: HEADERS });
    return handleResponse<{ reports: RouteReport[] }>(res);
  },

  async sendGpsPing(phone: string, tripId: string, lat: number, lon: number, heading?: number): Promise<void> {
    await fetch(`${API_BASE}/api/conductor/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ phone, trip_id: tripId, lat, lon, heading }),
    });
  },
};

// ── Transit Type Definitions ─────────────────────────────────────────────────

export interface NearbyStop {
  id: number;
  name: string;
  stage_name: string | null;
  lat: number;
  lon: number;
  distance_m: number;
}

export interface TransitStop {
  id: number;
  name: string;
  stage_name: string | null;
  lat: number;
  lon: number;
}

export interface LegStop {
  name: string;
  lat: number;
  lon: number;
  sequence: number;
}

export interface RouteLeg {
  leg_number: number;
  route_number: string;
  route_name: string;
  board_at: string;
  board_stage: string | null;
  board_lat: number | null;
  board_lon: number | null;
  alight_at: string;
  fare_kes: number;
  est_minutes: number;
  stops: LegStop[];
}

export interface RoutePlan {
  legs: RouteLeg[];
  total_fare_kes: number;
  total_minutes: number;
  transfers: number;
  summary: string;
}

export interface RoutePlanResponse {
  from: string;
  to: string;
  plans: RoutePlan[];
  message?: string;
}

export interface StageRoute {
  route_number: string;
  route_name: string;
  board_at: string | null;
  board_lat: number | null;
  board_lon: number | null;
  fare_min: number | null;
  fare_max: number | null;
}

export interface StageFindResponse {
  destination: string;
  routes: StageRoute[];
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

export interface JourneyStop {
  name: string;
  lat: number;
  lon: number;
  sequence: number;
}

export interface JourneyInfo {
  payment_id: string;
  route: string;
  destination: string;
  fare_kes: number;
  vehicle_lat: number | null;
  vehicle_lon: number | null;
  vehicle_updated_seconds_ago: number | null;
  route_stops: JourneyStop[];
  status: 'tracking' | 'arrived' | 'payment_pending';
}

export interface RouteReport {
  id: string;
  report_type: string;
  description: string;
  confirmed_by_conductor: boolean;
  upvotes: number;
  created_at: string;
}

