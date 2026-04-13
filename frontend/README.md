# Nairobi Transit — Frontend

Next.js 15 frontend for the Nairobi Transit cashless payment system. Built with React 19, TypeScript, and Tailwind v4 using Safaricom green branding.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Passenger home — map centred on Nairobi, nearby stop search, route A→B finder |
| `/ussd` | Interactive USSD simulator for testing the feature-phone payment flow |
| `/register` | Vehicle and conductor registration form |
| `/conductor` | Crew dashboard — set trip (route/fare/destination), live payment feed, QR display |
| `/settings` | System health check — API, database, Redis, Daraja status |

## Development

```bash
npm install
npm run dev       # http://localhost:3000
```

The API base URL is read from `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8080`). Create a `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Build

```bash
npm run build
npm start
```

## Stack

- **Next.js 15** with App Router
- **React 19**
- **TypeScript**
- **Tailwind CSS v4**
- API calls via `src/lib/api.ts` (typed fetch client + WebSocket helper)

## Deployment

Deployed automatically by DigitalOcean App Platform on push to `main`. See `.do/app.yaml` in the repository root.

