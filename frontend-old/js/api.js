// ================================================================
// Nairobi Transit — API Client
// Talks to the Rust backend at /api/*
// ================================================================

const API_BASE = 'https://dismount-litigate-broaden.ngrok-free.dev';

// ngrok free tier shows a browser warning page that breaks CORS;
// this header tells ngrok to skip it and proxy directly.
const HEADERS = { 'ngrok-skip-browser-warning': '1' };

const api = {
  /**
   * Look up active trip by vehicle short_id.
   * GET /api/qr/:vehicle_short_id
   */
  async getTrip(vehicleShortId) {
    const res = await fetch(`${API_BASE}/api/qr/${encodeURIComponent(vehicleShortId)}`, {
      headers: HEADERS,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * Initiate STK Push payment.
   * POST /api/pay/qr
   */
  async initiatePayment(vehicleShortId, passengerPhone) {
    const res = await fetch(`${API_BASE}/api/pay/qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({
        vehicle_short_id: vehicleShortId,
        passenger_phone: passengerPhone,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * Conductor sets a new trip.
   * POST /api/conductor/trip
   */
  async setTrip(phone, pin, route, destination, fareAmount) {
    const res = await fetch(`${API_BASE}/api/conductor/trip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({
        auth: { phone, pin },
        trip: { route, destination, fare_amount: fareAmount },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * Register a new vehicle.
   * POST /api/vehicles/register
   */
  async registerVehicle(plate, shortId, saccoName, paybillNo) {
    const res = await fetch(`${API_BASE}/api/vehicles/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({
        plate,
        short_id: shortId,
        sacco_name: saccoName,
        paybill_no: paybillNo,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * Register a new conductor.
   * POST /api/conductors/register
   */
  async registerConductor(phone, name, vehicleShortId, pin) {
    const res = await fetch(`${API_BASE}/api/conductors/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({
        phone,
        name,
        vehicle_short_id: vehicleShortId,
        pin,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * Connect to conductor WebSocket for live payment events.
   * Returns the WebSocket instance.
   */
  connectWS(onMessage, onOpen, onClose) {
    const wsBase = API_BASE.replace(/^http/, 'ws') || `ws://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/api/conductor/ws`);
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onopen = onOpen;
    ws.onclose = onClose;
    ws.onerror = () => ws.close();
    return ws;
  },
};
