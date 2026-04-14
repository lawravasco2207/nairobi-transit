# Nairobi Transit Documentation

Nairobi Transit is a cashless fare payment system built for Nairobi's matatu (minibus) network. It supports M-Pesa for smartphone users and USSD for feature phones, giving every passenger a way to pay without cash, regardless of device.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [For Passengers](#2-for-passengers)
3. [For Conductors & SACCOs](#3-for-conductors--saccos)
4. [Why Cashless?](#4-why-cashless)
5. [Challenges & Limitations](#5-challenges--limitations)
6. [GIS Data & Research](#6-gis-data--research)
7. [For Developers](#7-for-developers)

---

## 1. How It Works

The system connects passengers, conductors, and SACCOs through three building blocks:

- **M-Pesa (STK Push):** Smartphone passengers scan a QR code on the matatu, see the route and fare, then approve the payment with their M-Pesa PIN. The conductor is notified instantly.
- **USSD:** Feature phone passengers dial a short code (e.g. `*384*NRB23#`), see the fare, and confirm. Works on any GSM handset, no internet or app needed.
- **Conductor Dashboard:** The conductor sets the current route and fare. Payments appear in real time, and every transaction goes to the SACCO Paybill, never a personal M-Pesa line.

```
  📱 Passenger                           📋 Conductor
     │                                       │
     ├── Scan QR or dial USSD ──►  See fare & route
     │                                       │
     ├── Approve M-Pesa payment              │
     │                                       │
     └── ✓ Paid ◄────────────────  ✓ Instant notification
                                      (no waiting for SMS)
```

---

## 2. For Passengers

### Smartphone (QR Code)
1. Scan the QR code posted inside the matatu
2. See the route, destination, and fare before paying
3. Enter your M-Pesa number and tap **Pay**
4. Enter your M-Pesa PIN when prompted on your phone
5. Done. The conductor sees your payment immediately

### Feature Phone (USSD)
1. Dial `*384*` followed by the vehicle code shown in the matatu (e.g. `*384*NRB23#`)
2. See the route and fare, press **1** to pay
3. Enter your M-Pesa number
4. Confirm the payment
5. Enter your M-Pesa PIN when prompted, and you're done

**No app download, no account creation, no data connection required for USSD.**

---

## 3. For Conductors & SACCOs

### Getting Started
1. Register the matatu and conductor through the registration page
2. Log in to the conductor dashboard
3. Set the current trip: route, destination, and fare
4. A QR code is generated automatically for passengers to scan

### During a Trip
- Payments arrive instantly on the dashboard, no need to wait for M-Pesa SMS
- Every payment includes the passenger's phone number and a receipt reference
- All money goes to the SACCO's registered Paybill number

### For SACCOs
- Full transaction records for every vehicle and trip
- No cash handling means reduced conductor theft and robbery risk
- Automated audit trail for KRA compliance and internal accounting

---

## 4. Why Cashless?

| Problem today | How cashless helps |
|---------|------------------------------|
| Passengers don't know the correct fare | Fare is shown before payment, no surprises |
| Confirmation SMS is slow → fare disputes | Conductor gets instant notification, not SMS |
| Feature phone users are excluded from digital payments | USSD works on any handset, even without a data plan |
| Conductor's personal M-Pesa line is exposed | All money goes to the SACCO Paybill |
| Cash on hand attracts robbery | Less cash = less incentive for mugging |
| "It didn't go through" reversal abuse | Paybill reversals require a formal process |

---

## 5. Challenges & Limitations

No system is perfect. These are the honest trade-offs:

### Real-world
- **Spotty mobile signal.** USSD works well on 2G, but QR/M-Pesa requires a data connection. Some corridors have poor coverage.
- **Habit resistance.** Cash has worked for decades. Adoption needs SACCO mandates or passenger-side incentives.
- **SACCO buy-in required.** The system routes to a SACCO Paybill. Individual conductors can't go live without their SACCO on board.
- **Regulation.** Production deployment needs CBK (Central Bank of Kenya) oversight and a Safaricom-approved Paybill. The current system runs on Safaricom's sandbox, so no real money is moved.

### Technical
- **GIS data is from 2019.** Stop and route data may not reflect recent changes. See [section 6](#6-gis-data--research) for details.
- **USSD timeout.** Sessions last about 30 seconds. If you take too long, you'll need to re-dial.
- **Sandbox only.** The application currently uses Safaricom's test environment. No real payments are processed.

---

## 6. GIS Data & Research

### Source: Digital Matatus Project

> ⚠️ **The GIS data in this repository is from 2019 and may be significantly outdated.** Nairobi's matatu routes change frequently and informally. Do not rely on this data for real-time navigation.

The stop and route data in `GIS_DATA_2019/` and seeded into the database comes from the **Digital Matatus** project, a landmark civic technology initiative that mapped Nairobi's informal transit network using GTFS (General Transit Feed Specification) format for the first time.

**Project partners:**
- [MIT Civic Data Design Lab](https://civicdatadesignlab.mit.edu/) (Massachusetts Institute of Technology)
- University of Nairobi, Department of Urban & Regional Planning
- Columbia University
- Groupshot

**Data collection period:** 2012–2015  
**Shapefile snapshot used in this repo:** 2019

**Key outputs:**
- 4,284 matatu stops mapped across Nairobi and its suburbs
- 136 routes modelled as GTFS routes
- Full GTFS feed (stops.txt, routes.txt, shapes.txt, trips.txt, stop_times.txt)

**Project website:** http://www.digitalmatatus.com  
**Interactive map:** http://www.digitalmatatus.com/map.html  
**Academic paper:** Williams, S., Klopp, J., Bertini, D., Waiganjo, P., & White, A. (2015). *Digital Matatus: Using Mobile Technology to Map Transit Data in Developing Cities.* Transportation Research Record.

### Why the Data May Be Outdated

Nairobi's matatus operate under route licences issued by the National Transport and Safety Authority (NTSA), but routes are frequently altered through informal agreements, traffic conditions, and market forces. The Digital Matatus data captured a snapshot of the network as it existed circa 2012–2014. Since then:

- New routes have been created (e.g. BRT corridors)
- Several routes have had termini shifted
- NTSA has regulated and deregistered some routes
- Rapid urban expansion on the outskirts has made some stops obsolete

**What this means for the system:** Stop names and coordinates are good enough for nearby-stop lookups and fare routing, but should not be treated as authoritative for customer-facing navigation without a data refresh.

---

## 7. For Developers

This is an open-source project. The full codebase (backend, frontend, database migrations, GIS scripts, and deployment config) is available on GitHub:

**[github.com/lawravasco2207/nairobi-transit](https://github.com/lawravasco2207/nairobi-transit)**

The repository README covers architecture, setup instructions, API reference, database schema, and deployment details.
