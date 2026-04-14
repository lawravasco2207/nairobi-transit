use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};

use crate::AppState;

/// GET /pay/{vehicle_short_id}
/// Serves a self-contained HTML payment page that passengers see after scanning a QR code.
pub async fn pay_page(
    State(state): State<AppState>,
    Path(vehicle_short_id): Path<String>,
) -> Response {
    // Look up active trip to show route/fare info
    let trip = match crate::db::trips::get_active_trip_by_vehicle_short_id(
        &state.db,
        &vehicle_short_id,
    )
    .await
    {
        Ok(Some(t)) => t,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "No active trip for this vehicle.")
                .into_response();
        }
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Server error")
                .into_response();
        }
    };

    let fare_kes = trip.fare_kes;
    let ussd_code = format!("*384*{}#", vehicle_short_id);

    let sandbox_banner = if state.config.is_sandbox() {
        r#"<div style="background:#FFF3CD;color:#856404;padding:10px 16px;font-size:13px;text-align:center;border-bottom:1px solid #FFEEBA">⚠️ Demo mode — no real money will be charged. Payments are simulated.</div>"#
    } else {
        ""
    };

    let html = format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay Fare — Nairobi Transit</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#f5f5f5;color:#333;display:flex;justify-content:center;
       padding:24px 16px}}
  .card{{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.1);
        max-width:400px;width:100%;overflow:hidden}}
  .header{{background:#00A650;color:#fff;padding:20px;text-align:center}}
  .header h1{{font-size:20px;margin-bottom:4px}}
  .header p{{font-size:14px;opacity:.85}}
  .body{{padding:24px}}
  .info{{display:flex;justify-content:space-between;padding:10px 0;
        border-bottom:1px solid #eee;font-size:14px}}
  .info:last-of-type{{border:none}}
  .info .label{{color:#666}}
  .info .value{{font-weight:600}}
  .fare{{font-size:28px;text-align:center;padding:16px 0;color:#00A650;font-weight:700}}
  label{{display:block;font-size:14px;color:#555;margin:16px 0 6px}}
  input{{width:100%;padding:14px;border:1px solid #ddd;border-radius:10px;
        font-size:16px;outline:none}}
  input:focus{{border-color:#00A650}}
  button{{width:100%;padding:14px;border:none;border-radius:10px;font-size:16px;
         font-weight:600;cursor:pointer;margin-top:16px;background:#00A650;color:#fff}}
  button:disabled{{opacity:.6;cursor:not-allowed}}
  .msg{{text-align:center;padding:12px;border-radius:8px;margin-top:12px;font-size:14px}}
  .msg.ok{{background:#e6f9ed;color:#00703C}}
  .msg.err{{background:#fdeaea;color:#c0392b}}
  .ussd-alt{{text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #eee;
            font-size:13px;color:#888}}
  .ussd-alt code{{background:#f0f0f0;padding:2px 6px;border-radius:4px;
                  font-size:14px;color:#333}}
</style>
</head>
<body>
{sandbox_banner}
<div class="card">
  <div class="header">
    <h1>Nairobi Transit</h1>
    <p>Cashless Matatu Payment</p>
  </div>
  <div class="body">
    <div class="info"><span class="label">Vehicle</span><span class="value">{vehicle_short_id}</span></div>
    <div class="info"><span class="label">Route</span><span class="value">{route}</span></div>
    <div class="info"><span class="label">Destination</span><span class="value">{destination}</span></div>
    <div class="fare">KES {fare_kes}</div>

    <label for="phone">M-Pesa Phone Number</label>
    <input id="phone" type="tel" placeholder="07XX XXX XXX" maxlength="13" autocomplete="tel">

    <button id="payBtn" onclick="pay()">Pay with M-Pesa</button>
    <div id="msg"></div>

    <div class="ussd-alt">
      No data? Dial <code>{ussd_code}</code>
    </div>
  </div>
</div>
<script>
async function pay() {{
  const phone = document.getElementById('phone').value.trim();
  if (!phone) return;
  const btn = document.getElementById('payBtn');
  const msg = document.getElementById('msg');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  msg.className = 'msg';
  msg.textContent = '';
  try {{
    const res = await fetch('/api/pay/qr', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ vehicle_short_id: '{vehicle_short_id}', passenger_phone: phone }})
    }});
    const data = await res.json();
    if (res.ok) {{
      msg.className = 'msg ok';
      msg.textContent = data.message || 'Check your phone for the M-Pesa prompt!';
    }} else {{
      msg.className = 'msg err';
      msg.textContent = data.error || 'Payment failed. Try again.';
    }}
  }} catch(e) {{
    msg.className = 'msg err';
    msg.textContent = 'Network error. Try again.';
  }}
  btn.disabled = false;
  btn.textContent = 'Pay with M-Pesa';
}}
</script>
</body>
</html>"##,
        vehicle_short_id = vehicle_short_id,
        route = html_escape(&trip.route),
        destination = html_escape(&trip.destination),
        fare_kes = fare_kes,
        ussd_code = ussd_code,
        sandbox_banner = sandbox_banner,
    );

    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
