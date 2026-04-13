// ================================================================
// Nairobi Transit — Application Logic
// Manages page navigation, payment flow, USSD simulator,
// conductor dashboard, and WebSocket live feed.
// ================================================================

// ── Page Navigation ─────────────────────────────────────────────
document.querySelectorAll('.header__nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;

    // Update nav
    document.querySelectorAll('.header__nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');

    // Show page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');

    // Connect WS if entering conductor page
    if (page === 'conductor' && !wsConnection) {
      connectPaymentFeed();
    }
  });
});

// ── Tab Switching (Conductor) ───────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
  });
});


// ================================================================
// PASSENGER PAYMENT FLOW
// ================================================================

let currentTrip = null;

async function lookupTrip() {
  const code = document.getElementById('vehicle-code').value.trim().toUpperCase();
  if (!code) return;

  const btn = document.getElementById('btn-lookup');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Looking up…';

  try {
    const data = await api.getTrip(code);
    currentTrip = data;
    showTripInfo(data);
    document.getElementById('pay-step1').style.display = 'none';
    document.getElementById('pay-step2').style.display = 'block';
  } catch (err) {
    showAlert('pay-step1', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Trip';
  }
}

function showTripInfo(data) {
  document.getElementById('fare-amount').textContent = data.fare_kes;
  document.getElementById('trip-info-display').innerHTML = `
    <div class="trip-info__row">
      <span class="trip-info__label">Route</span>
      <span class="trip-info__value">${escapeHtml(data.route)}</span>
    </div>
    <div class="trip-info__row">
      <span class="trip-info__label">Destination</span>
      <span class="trip-info__value">${escapeHtml(data.destination)}</span>
    </div>
    <div class="trip-info__row">
      <span class="trip-info__label">Vehicle</span>
      <span class="trip-info__value">${escapeHtml(data.vehicle_short_id)}</span>
    </div>
    <div class="trip-info__row">
      <span class="trip-info__label">USSD Fallback</span>
      <span class="trip-info__value">${escapeHtml(data.ussd_fallback)}</span>
    </div>
  `;
}

async function initiatePayment() {
  const phone = document.getElementById('phone-number').value.trim();
  if (!phone || !currentTrip) return;

  const btn = document.getElementById('btn-pay');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending to M-Pesa…';

  try {
    const result = await api.initiatePayment(currentTrip.vehicle_short_id, phone);
    document.getElementById('pay-ref').textContent = `Payment ID: ${result.payment_id}`;
    document.getElementById('pay-step2').style.display = 'none';
    document.getElementById('pay-step3').style.display = 'block';

    // Simulate success after a few seconds (in production, the webhook handles this)
    simulatePaymentSuccess(phone);
  } catch (err) {
    showAlert('pay-step2', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pay Now';
  }
}

function simulatePaymentSuccess(phone) {
  // In production the Daraja webhook confirms this.
  // For demo, we simulate it after 5 seconds.
  setTimeout(() => {
    document.getElementById('receipt-details').innerHTML = `
      <div class="trip-info__row">
        <span class="trip-info__label">Amount</span>
        <span class="trip-info__value">KES ${currentTrip.fare_kes}</span>
      </div>
      <div class="trip-info__row">
        <span class="trip-info__label">Route</span>
        <span class="trip-info__value">${escapeHtml(currentTrip.route)}</span>
      </div>
      <div class="trip-info__row">
        <span class="trip-info__label">M-Pesa Ref</span>
        <span class="trip-info__value">QHX${Math.random().toString(36).slice(2,8).toUpperCase()}</span>
      </div>
      <div class="trip-info__row">
        <span class="trip-info__label">Phone</span>
        <span class="trip-info__value">${escapeHtml(phone)}</span>
      </div>
    `;
    document.getElementById('pay-step3').style.display = 'none';
    document.getElementById('pay-step4').style.display = 'block';
  }, 5000);
}

function resetPayFlow() {
  currentTrip = null;
  document.getElementById('vehicle-code').value = '';
  document.getElementById('phone-number').value = '';
  ['pay-step2', 'pay-step3', 'pay-step4'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('pay-step1').style.display = 'block';
}


// ================================================================
// USSD SIMULATOR
// ================================================================

let ussdStep = 0;
let ussdVehicle = '';
let ussdText = '';

function sendUssd() {
  const input = document.getElementById('ussd-input');
  const val = input.value.trim();
  if (!val) return;

  const screen = document.getElementById('ussd-screen');

  // Initial dial — parse *384*CODE#
  if (ussdStep === 0 && val.startsWith('*') && val.endsWith('#')) {
    const match = val.match(/\*384\*(\w+)#/);
    if (!match) {
      screen.textContent = 'Invalid code. Try *384*NRB23#';
      input.value = '';
      return;
    }
    ussdVehicle = match[1].toUpperCase();
    ussdText = '';
    ussdStep = 1;

    // Show trip info (simulated)
    screen.textContent =
`Route: CBD → Kasarani
To: Kasarani Stage
Fare: Ksh 60

1. Pay now
2. Cancel`;
    input.value = '';
    input.placeholder = 'Enter 1 or 2';
    return;
  }

  // Step 1: Pay or cancel
  if (ussdStep === 1) {
    if (val === '2') {
      screen.textContent = 'Cancelled. No charge made.';
      resetUssd();
      return;
    }
    if (val === '1') {
      ussdText = '1';
      ussdStep = 2;
      screen.textContent =
`Enter your Safaricom number
(e.g. 0712345678):`;
      input.value = '';
      input.placeholder = '0712345678';
      return;
    }
    screen.textContent = 'Invalid option.\n\n1. Pay now\n2. Cancel';
    input.value = '';
    return;
  }

  // Step 2: Phone number
  if (ussdStep === 2) {
    ussdText = `1*${val}`;
    ussdStep = 3;
    screen.textContent =
`Confirm payment:
Ksh 60 → Kasarani Stage
Phone: ${val}

1. Confirm
2. Cancel`;
    input.value = '';
    input.placeholder = 'Enter 1 or 2';
    return;
  }

  // Step 3: Confirm
  if (ussdStep === 3) {
    if (val === '2') {
      screen.textContent = 'Cancelled. No charge made.';
      resetUssd();
      return;
    }
    if (val === '1') {
      screen.textContent =
`Ksh 60 payment initiated.
Enter M-Pesa PIN on your phone.
Do NOT close until complete.

✓ Session ended`;
      resetUssd();
      return;
    }
    screen.textContent = 'Invalid input.\n\n1. Confirm\n2. Cancel';
    input.value = '';
    return;
  }

  // Fallback
  input.value = '';
  input.placeholder = '*384*NRB23#';
}

function resetUssd() {
  ussdStep = 0;
  ussdVehicle = '';
  ussdText = '';
  const input = document.getElementById('ussd-input');
  input.value = '';
  input.placeholder = '*384*NRB23#';
}


// ================================================================
// CONDUCTOR DASHBOARD
// ================================================================

// ── Conductor credentials ───────────────────────────────────────
// No hardcoded IDs — conductor authenticates with phone + PIN

async function setTrip() {
  const phone = document.getElementById('trip-phone').value.trim();
  const pin = document.getElementById('trip-pin').value;
  const route = document.getElementById('trip-route').value.trim();
  const dest = document.getElementById('trip-dest').value.trim();
  const fare = parseInt(document.getElementById('trip-fare').value, 10);

  if (!phone || !pin || !route || !dest || !fare) {
    showAlert('tab-set-trip', 'Please fill in all fields', 'error');
    return;
  }

  const btn = document.getElementById('btn-set-trip');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Setting trip…';

  try {
    const result = await api.setTrip(phone, pin, route, dest, fare);
    document.getElementById('trip-result').style.display = 'block';
    document.getElementById('trip-result').innerHTML = `
      <div class="alert alert--success">
        ✅ ${escapeHtml(result.message)}
      </div>
      <div class="trip-info">
        <div class="trip-info__row">
          <span class="trip-info__label">USSD Code</span>
          <span class="trip-info__value" style="font-family:monospace">${escapeHtml(result.ussd_code)}</span>
        </div>
        <div class="trip-info__row">
          <span class="trip-info__label">QR URL</span>
          <span class="trip-info__value" style="font-size:12px; word-break:break-all">${escapeHtml(result.qr_url)}</span>
        </div>
        <div class="trip-info__row">
          <span class="trip-info__label">Trip ID</span>
          <span class="trip-info__value" style="font-size:11px; font-family:monospace">${escapeHtml(result.trip_id)}</span>
        </div>
      </div>
    `;
  } catch (err) {
    showAlert('tab-set-trip', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Set Trip';
  }
}


// ── WebSocket Live Payment Feed ─────────────────────────────────
let wsConnection = null;
let totalCollected = 0;

function connectPaymentFeed() {
  const dot = document.getElementById('ws-dot');
  const status = document.getElementById('ws-status');

  wsConnection = api.connectWS(
    // onMessage
    (event) => {
      if (event.event === 'payment_confirmed') {
        addPaymentToFeed(event);
        totalCollected += event.amount_kes;
        document.getElementById('total-collected').textContent = `KES ${totalCollected.toLocaleString()}`;
      }
    },
    // onOpen
    () => {
      dot.className = 'status-dot status-dot--live';
      status.textContent = 'Connected — live updates';
    },
    // onClose
    () => {
      dot.className = 'status-dot status-dot--off';
      status.textContent = 'Disconnected — will retry…';
      wsConnection = null;
      setTimeout(connectPaymentFeed, 3000);
    }
  );
}

function addPaymentToFeed(event) {
  const feed = document.getElementById('payment-feed');
  // Remove empty state
  const empty = feed.querySelector('.empty-state');
  if (empty) empty.remove();

  const maskedPhone = event.passenger_phone.replace(/(\d{3})\d{6}(\d{3})/, '$1******$2');
  const time = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

  const item = document.createElement('div');
  item.className = 'payment-item';
  item.innerHTML = `
    <div class="payment-item__icon">✓</div>
    <div class="payment-item__details">
      <div class="payment-item__phone">${escapeHtml(maskedPhone)}</div>
      <div class="payment-item__meta">${escapeHtml(event.mpesa_ref)} · ${event.channel.toUpperCase()} · ${time}</div>
    </div>
    <div class="payment-item__amount">+${event.amount_kes}</div>
  `;

  feed.prepend(item);
}


// ── QR Code Viewer ──────────────────────────────────────────────
async function loadQR() {
  const code = document.getElementById('qr-vehicle-code').value.trim().toUpperCase();
  if (!code) return;

  try {
    const data = await api.getTrip(code);
    document.getElementById('qr-container').style.display = 'flex';
    document.getElementById('qr-img').src = data.qr_image_base64;
    document.getElementById('qr-ussd-code').textContent = data.ussd_fallback;
    document.getElementById('qr-route-info').textContent = `${data.route} · KES ${data.fare_kes}`;
  } catch (err) {
    showAlert('tab-qr-view', err.message, 'error');
  }
}


// ================================================================
// DEMO MODE — Simulate payments for demo purposes
// ================================================================

// If no backend is running, simulate payment feed events every 8-15s
let demoMode = false;

function startDemoMode() {
  demoMode = true;
  document.getElementById('ws-dot').className = 'status-dot status-dot--live';
  document.getElementById('ws-status').textContent = 'Demo mode — simulated payments';

  const phones = ['254712345678', '254798765432', '254700111222', '254711333444', '254723555666'];
  const channels = ['stk', 'ussd'];
  const refs = () => 'QHX' + Math.random().toString(36).slice(2, 8).toUpperCase();

  function pushDemo() {
    const event = {
      event: 'payment_confirmed',
      passenger_phone: phones[Math.floor(Math.random() * phones.length)],
      amount_kes: [30, 40, 50, 60, 70, 80, 100][Math.floor(Math.random() * 7)],
      mpesa_ref: refs(),
      channel: channels[Math.floor(Math.random() * channels.length)],
      trip_id: '00000000-0000-0000-0000-000000000003',
    };
    addPaymentToFeed(event);
    totalCollected += event.amount_kes;
    document.getElementById('total-collected').textContent = `KES ${totalCollected.toLocaleString()}`;
    setTimeout(pushDemo, 8000 + Math.random() * 7000);
  }

  setTimeout(pushDemo, 2000);
}


// ================================================================
// UTILITIES
// ================================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showAlert(containerId, message, type) {
  const container = document.getElementById(containerId);
  // Remove existing alerts
  container.querySelectorAll('.alert').forEach(a => a.remove());

  const alert = document.createElement('div');
  alert.className = `alert alert--${type}`;
  alert.textContent = message;
  container.prepend(alert);

  setTimeout(() => alert.remove(), 5000);
}

// Auto-start demo mode if WS connection fails (no backend running)
setTimeout(() => {
  if (!wsConnection && document.getElementById('page-conductor').classList.contains('active')) {
    startDemoMode();
  }
}, 3000);


// ================================================================
// REGISTRATION (Vehicle + Conductor)
// ================================================================

async function registerVehicle() {
  const plate = document.getElementById('reg-plate').value.trim().toUpperCase();
  const shortId = document.getElementById('reg-short-id').value.trim().toUpperCase();
  const sacco = document.getElementById('reg-sacco').value.trim();
  const paybill = document.getElementById('reg-paybill').value.trim();

  if (!plate || !shortId || !sacco || !paybill) {
    showAlert('tab-reg-vehicle', 'Please fill in all fields', 'error');
    return;
  }

  const btn = document.getElementById('btn-reg-vehicle');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Registering…';

  try {
    const result = await api.registerVehicle(plate, shortId, sacco, paybill);
    const el = document.getElementById('reg-vehicle-result');
    el.style.display = 'block';
    el.innerHTML = `
      <div class="alert alert--success">✅ ${escapeHtml(result.message)}</div>
      <div class="trip-info">
        <div class="trip-info__row">
          <span class="trip-info__label">Vehicle ID</span>
          <span class="trip-info__value" style="font-size:11px; font-family:monospace">${escapeHtml(result.vehicle_id)}</span>
        </div>
        <div class="trip-info__row">
          <span class="trip-info__label">Vehicle Code</span>
          <span class="trip-info__value" style="font-weight:700; letter-spacing:2px">${escapeHtml(result.short_id)}</span>
        </div>
        <div class="trip-info__row">
          <span class="trip-info__label">USSD Code</span>
          <span class="trip-info__value" style="font-family:monospace">${escapeHtml(result.ussd_code)}</span>
        </div>
      </div>
    `;
    // Clear form
    document.getElementById('reg-plate').value = '';
    document.getElementById('reg-short-id').value = '';
    document.getElementById('reg-sacco').value = '';
    document.getElementById('reg-paybill').value = '';
  } catch (err) {
    showAlert('tab-reg-vehicle', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Register Vehicle';
  }
}

async function registerConductor() {
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const vehicleCode = document.getElementById('reg-vehicle-code').value.trim().toUpperCase();
  const pin = document.getElementById('reg-pin').value;

  if (!name || !phone || !vehicleCode || !pin) {
    showAlert('tab-reg-conductor', 'Please fill in all fields', 'error');
    return;
  }

  if (pin.length < 4) {
    showAlert('tab-reg-conductor', 'PIN must be at least 4 digits', 'error');
    return;
  }

  const btn = document.getElementById('btn-reg-conductor');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Registering…';

  try {
    const result = await api.registerConductor(phone, name, vehicleCode, pin);
    const el = document.getElementById('reg-conductor-result');
    el.style.display = 'block';
    el.innerHTML = `
      <div class="alert alert--success">✅ ${escapeHtml(result.message)}</div>
      <div class="trip-info">
        <div class="trip-info__row">
          <span class="trip-info__label">Conductor ID</span>
          <span class="trip-info__value" style="font-size:11px; font-family:monospace">${escapeHtml(result.conductor_id)}</span>
        </div>
        <div class="trip-info__row">
          <span class="trip-info__label">Vehicle ID</span>
          <span class="trip-info__value" style="font-size:11px; font-family:monospace">${escapeHtml(result.vehicle_id)}</span>
        </div>
      </div>
      <p style="margin-top:12px; font-size:13px; color:var(--gray-500)">
        Save your Conductor ID and Vehicle ID — you'll need them to set trips.
      </p>
    `;
    // Clear form
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-phone').value = '';
    document.getElementById('reg-vehicle-code').value = '';
    document.getElementById('reg-pin').value = '';
  } catch (err) {
    showAlert('tab-reg-conductor', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Register Conductor';
  }
}
