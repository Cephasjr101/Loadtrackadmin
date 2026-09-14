# LoadMatch Backend (MVP)

REST API for the LoadMatch empty-truck marketplace. Node.js ≥18, Express, JWT auth,
bcrypt password hashing, zod validation, JSON-file persistence (swap for Postgres/SQLite
in production). **No secrets in code** — everything sensitive lives in `.env`.

## Quick start

```bash
cp .env.example .env        # then edit secrets
npm install
npm run seed                # demo users: carrier@demo.gh / shipper@demo.gh (password123)
npm start                   # http://localhost:4000/api
npm run smoke               # end-to-end test (in a second terminal)
```

## Data model

| Collection | Key fields |
|---|---|
| `users` | email, passwordHash (bcrypt), name, phone, role `carrier`\|`shipper`, verified |
| `trucks` | ownerId, plateNo, from/to, truckType, capacityKg, volumeM3, ratePerKm, window, verified |
| `loads` | shipperId, cargo, from/to, weightKg, volumeM3, budgetGhs, pickupDate, deliveryDate |
| `matches` | truckId, loadId, priceGhs, commissionPct, status, escrowStatus, signatures, deliveryOtp |
| `crumbs` | matchId, lat, lng, note, at (GPS breadcrumbs) |

## Match lifecycle

```
proposed → contract_signed (both parties e-sign) → ready_for_pickup (escrow funded)
→ in_transit (carrier departs, OTP generated) → delivered (shipper submits OTP) → escrow released
```

## API reference

All endpoints return JSON. Authenticated endpoints need `Authorization: Bearer <token>`.
Admin endpoints need header `X-Admin-Key: <ADMIN_KEY>`.

### Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | email, password (≥8), name, phone (GH), role | 201 → `{token, user}` |
| POST | `/api/auth/login` | email, password | 401 on bad credentials |
| GET | `/api/auth/me` | — | current user |

### Trucks / Loads
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/trucks?from=&to=` | — | list; filters optional |
| POST | `/api/trucks` | carrier | creates unverified (pending review) |
| GET/PATCH/DELETE | `/api/trucks/:id` | owner for write | 403 if not yours |
| GET | `/api/loads?from=&to=` | — | list |
| POST | `/api/loads` | shipper | |
| GET/DELETE | `/api/loads/:id` | owner for delete | |

### Matching & deals
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/matches/run` | any | scores **all** truck×load pairs (reverse route 100 pts, capacity/volume/dates/budget/verified tune) |
| POST | `/api/matches` | any | `{truckId, loadId, priceGhs?, commissionPct?}` → proposed deal + generated contract text |
| GET | `/api/matches` | any | your deals (party only) |
| GET | `/api/matches/:id` | party | includes escrow breakdown; **OTP visible to shipper only** |
| POST | `/api/matches/:id/sign` | party | `{signerName, accept:true}`; both signed → `contract_signed` |
| POST | `/api/matches/:id/fund` | shipper | simulated escrow hold (replace with PSP webhook) |
| POST | `/api/matches/:id/depart` | carrier | → `in_transit`, generates 6-digit delivery OTP |
| POST | `/api/matches/:id/track` | carrier | `{lat, lng, note?}` GPS breadcrumb |
| GET | `/api/matches/:id/track` | party | crumbs + progress |
| POST | `/api/matches/:id/confirm` | shipper | `{otp}` → `delivered`, escrow **released** |

### Payments (Paystack)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/payments/config/public` | — | public runtime config: **public key** + commission band (no secrets) |
| POST | `/api/matches/:id/pay/initialize` | shipper | creates a Paystack transaction (GHS→pesewas), returns `authorizationUrl` + `reference` |
| POST | `/api/payments/webhook` | signature | Paystack `charge.success` events; HMAC-SHA512 verified on the **raw body**; re-verifies server-to-server before holding escrow |
| GET | `/api/payments/verify/:reference` | party | browser-callback fallback; confirms with Paystack and settles |

Without `PAYSTACK_SECRET_KEY`, escrow endpoints run in **simulation mode**
(`POST /:id/fund` with `{simulate:true}` holds escrow directly) so the whole
lifecycle is testable end-to-end with no keys.

**Webhook setup** (Paystack dashboard): point to `https://your-domain/api/payments/webhook`.
The secret key doubles as the webhook HMAC secret — the signature is validated with
`timingSafeEqual` before any state change, and the event amount is never trusted:
the transaction is re-fetched from Paystack before escrow is marked held.

### Admin
| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/trucks/:id/verify` | mark carrier verified (the 24h review step) |
| GET | `/api/admin/trucks/pending` | verification queue |
| GET | `/api/admin/stats` | KPIs incl. commission earned |

## Security

- bcrypt (cost 10) password hashing; JWT with 7-day TTL; secrets from env only
- zod schema validation on every mutating endpoint (GH phone regex, date ranges, city enum)
- role checks on every route; match access restricted to the two parties
- OTP only exposed to the shipper; wrong OTP rejected without state change
- rate limiting: 20 req/min on `/api/auth/*`, 300 req/min elsewhere (per IP)
- security headers mirroring the frontend `.htaccess`; optional CORS lock to `CORS_ORIGIN`
- JSON body capped at 100 kb

## Production notes

1. **Persistence** — replace `src/db.js` with Postgres/SQLite; the route layer won't change.
2. **Escrow** — Paystack is already wired: `/pay/initialize` + webhook. For payouts to carriers, add Paystack Transfers (requires a balance-funded integration) and call it after OTP confirmation.
3. **OTP** — deliver by SMS (HubTel/Arkesel) at departure; keep the 6-digit comparison server-side.
4. **GPS** — trucks post crumbs from a driver app; keep the carrier-only write rule.
5. Put behind HTTPS (terminate TLS at nginx/your host) and set strong `JWT_SECRET` / `ADMIN_KEY`.
