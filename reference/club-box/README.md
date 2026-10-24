# Club box

A small self-hosted reference app for two club jobs:

1. **Court booking.** List courts and slots, hold one, pay a Lightning invoice, and confirm the booking when the invoice settles.
2. **Member-area entry.** Enroll a Lightning wallet with LNURL-auth (LUD-04). A kiosk shows a rotating challenge QR. A valid signature from an active member pulses an entry lock and writes an audit row.

Both run in one Node process with SQLite. Payment processors and the door controller are adapters. The **mock** adapters need no Lightning node and no hardware, so you can try the whole flow on a laptop.

This is reference code, not a turnkey access-control product. Read the safety section before you connect a door.

## Safety

This process can send one command: a short **entry** pulse (`pulse-entry`).

- It cannot lock a door shut, hold a door closed, or control an exit.
- Leaving does not use this service. Request-to-exit, panic hardware, and fire-alarm release stay on circuits this software cannot reach.
- It does not touch fire or other life-safety systems.
- If the kiosk cannot reach the server, people use a fob, a PIN, or staff. Failed unlocks are not queued for later.
- Hours, if you set them, are checked when the QR is minted and again when the signature arrives. A closed area is not unlocked.
- Put any real relay on a private network. Do not publish an unauthenticated unlock URL.

Design the physical door with a licensed access-control installer and your fire marshal. Fail-safe versus fail-secure is a code decision for that door.

The same sentences are on the kiosk page, so they stay visible if the API is down. `GET /api/health` reports `controlsEgress: false` and `controlsLifeSafety: false`.

## License

Code in this directory is [MIT](../../LICENSE), the same license as the rest of the kit's code. The playbooks that describe this design stay [CC BY-SA 4.0](../../LICENSE-docs).

## What you need

- Node.js 22.13 or newer (the Docker image uses Node 22)
- npm
- For a real door pulse: the example HTTP relay, or your own controller that accepts the same JSON

No Bitcoin node is required when `PAYMENT_BACKEND=mock`.

## Run locally with the mock backend

From this directory:

```bash
cp .env.example .env
```

Edit `.env`. You must set:

- `CURRENCY` — a 3-letter code you use for slot prices (for example the code your bookkeeper uses)
- `CURRENCY_DECIMALS` — digits after the major unit (often `2`)
- `ADMIN_TOKEN` — a long random string, at least 16 characters (`openssl rand -hex 24`)

Leave `PAYMENT_BACKEND=mock` and `DOOR_BACKEND=mock`. Leave price fields empty if you want to type every price in the admin page. `DEFAULT_SLOT_PRICE_MINOR` is optional and is only a helper for the generate-slots API.

```bash
npm ci
npm run dev
```

Open:

| Page | URL |
|---|---|
| Booking | http://127.0.0.1:3000/ |
| Admin | http://127.0.0.1:3000/admin |
| Door kiosk | http://127.0.0.1:3000/kiosk |
| Enrollment | linked from Admin after you add a member |

The database file is `./data/club.sqlite` unless you change `DATABASE_PATH`.

### Try a booking

1. On **Admin**, paste the admin token and load the page.
2. Add a court.
3. Add a slot. Type the price in **minor units** of `CURRENCY` (the smallest unit your currency uses). The form does not fill a price in for you.
4. On **Booking**, pick the slot and hold it. The page shows a QR and a mock invoice string that starts with `mock-not-payable:`. That string is not a payable BOLT11 invoice.
5. Back on **Admin**, use **Simulate payment** on that hold. The slot becomes a booking. A second visitor cannot hold the same slot while the hold is pending or after it is paid.
6. **Download CSV** saves bookings with the minor-unit amount and currency for your bookkeeper. The download sends the admin token; it is not a public link.

Unpaid holds expire after `HOLD_MINUTES` (default 15). A settlement that arrives after expiry does not create a booking; the slot opens again. A second settlement notice for the same invoice does not create a second booking.

To fill a day of slots without clicking each one, send `POST /api/admin/slots/generate` with the admin token and JSON:

```json
{
  "courtId": "crt_…",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "slotMinutes": 60,
  "priceMinor": 0
}
```

Replace `priceMinor` with your own integer in minor units. The `0` above is only a shape example and the server rejects it. `priceMinor` can be omitted only when `DEFAULT_SLOT_PRICE_MINOR` is set. Times are in `CLUB_TIMEZONE`. The admin page itself does not include this helper; it is an API.

### Try member entry

1. On **Admin**, add a member. The label is a membership number or similar handle. Do not store a person's name unless your privacy policy says so.
2. Open **Enrollment link**. The page shows an LNURL-auth QR tied to that member.
3. A wallet that supports LNURL-auth scans it and signs the challenge. The server stores the linking public key.
4. Open **Door kiosk**, pick an area from `ACCESS_AREAS`, and scan the rotating QR with the same wallet.
5. On a valid signature from an **active** enrolled member, the mock door records one entry pulse and the access log gains a row.

Without a wallet you can still confirm the kiosk renders, rotates, and states the safety rules. Automated tests sign challenges with an ephemeral key so the signature path does not depend on a wallet.

Revoke a member or a single key from Admin. A revoked member or key does not unlock. Restore returns a member to active; revoked keys stay revoked until the member enrolls again.

## Tests

```bash
npm test
npm run typecheck
```

The suite covers:

- LNURL-auth signature checks (compact, recoverable, and DER), a bad signature, expiry, replay, rate limits, revoked members, and area hours
- Invoice settlement for the mock backend, BTCPay Greenfield webhooks (HMAC, settled, expired), and LNbits webhooks (path secret, pending vs paid)
- Slot double-booking, including two concurrent claims, plus a price that changed under a player
- The example HTTP relay: it pulses on `pulse-entry` and rejects lock, fire, and egress commands

Tests use an ephemeral SQLite file and a fixture price of one minor unit. That number is not a club price.

## Configuration

Copy [`.env.example`](.env.example). It contains no real secrets. Prices are never hard-coded in the app: every slot stores the minor-unit amount you send, or `DEFAULT_SLOT_PRICE_MINOR` when you use the generate helper and omit `priceMinor`.

| Variable | Role |
|---|---|
| `HOST`, `PORT` | Bind address. Local default is `127.0.0.1:3000`. Compose sets `HOST=0.0.0.0`. |
| `DATABASE_PATH` | SQLite file. |
| `PUBLIC_BASE_URL` | Origin wallets and webhooks call. Must match the URL the phone can reach. |
| `CURRENCY`, `CURRENCY_DECIMALS` | Required. Slot currency and the scale of minor units. |
| `DEFAULT_SLOT_PRICE_MINOR` | Optional helper. Empty means every admin request must include `priceMinor`. |
| `SATS_PER_MINOR_UNIT` | Required for LNbits. BTCPay invoices in `CURRENCY` and converts itself. |
| `HOLD_MINUTES` | Unpaid hold lifetime. |
| `PAYMENT_BACKEND` | `mock`, `btcpay`, or `lnbits`. |
| `BTCPAY_URL`, `BTCPAY_STORE_ID`, `BTCPAY_API_KEY`, `BTCPAY_WEBHOOK_SECRET` | Greenfield. Required when the backend is `btcpay`. |
| `BTCPAY_PAYMENT_METHOD` | Default `BTC-LN`. Some servers use `BTC-LightningNetwork`. |
| `LNBITS_URL`, `LNBITS_INVOICE_KEY`, `LNBITS_WEBHOOK_SECRET` | Required when the backend is `lnbits`. The secret is 16–128 characters from `[A-Za-z0-9_-]` because it sits in the webhook path. |
| `DOOR_BACKEND` | `mock` or `http`. |
| `DOOR_HTTP_URL`, `DOOR_HTTP_TOKEN`, `DOOR_HTTP_TIMEOUT_MS` | Required for `http`. Token at least 16 characters. |
| `DOOR_PULSE_MS` | Pulse length, 200–10000 ms. Default 3000. |
| `K1_TTL_SECONDS` | Challenge lifetime, 15–300. Default 90. |
| `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX` | Callback and hold limits. |
| `CHALLENGE_RATE_LIMIT_MAX` | How often the kiosk may mint a new QR. |
| `ADMIN_TOKEN` | Required. Bearer token for `/api/admin/*`. At least 16 characters. |
| `ACCESS_AREAS` | Comma-separated ids such as `lounge,after-hours`. |
| `ACCESS_AREA_HOURS` | Optional `area=HH:MM-HH:MM` pairs. Empty means the area is allowed whenever the server is up. A window that wraps past midnight is written with the start later than the end. |
| `CLUB_TIMEZONE` | IANA name. Default `UTC`. Used for hours and generated slots. |
| `LOG_RETENTION_DAYS` | Access-log and old-challenge retention. Default 90. |
| `TRUST_PROXY` | `true` only behind a proxy that sets `X-Forwarded-For`. |

Admin routes expect `Authorization: Bearer <ADMIN_TOKEN>`. The admin page keeps the token in `sessionStorage` for that browser tab.

## BTCPay Server

1. Create a store with Lightning enabled and a Greenfield API key that can create invoices.
2. Set `PAYMENT_BACKEND=btcpay` and the `BTCPAY_*` values. `PUBLIC_BASE_URL` must be the URL BTCPay can call.
3. In the store, add a webhook to `https://<your-host>/api/webhooks/btcpay` with the same secret as `BTCPAY_WEBHOOK_SECRET`. Send the invoice events that include settled, expired, and invalid.
4. The app creates a fiat invoice in `CURRENCY` for the slot's minor-unit amount, then reads the Lightning BOLT11 from the payment method named by `BTCPAY_PAYMENT_METHOD`.
5. A booking is confirmed only when the webhook signature matches and the event is `InvoiceSettled` (or the equivalent `invoice_settled`). `InvoiceExpired` and `InvoiceInvalid` release the hold. Other events are ignored.

The mock **Simulate payment** button is absent when this backend is selected.

## LNbits

1. Set `PAYMENT_BACKEND=lnbits`, the wallet invoice key, and `SATS_PER_MINOR_UNIT` (how many sats equal one minor unit of `CURRENCY` at the rate you choose to charge).
2. Set `LNBITS_WEBHOOK_SECRET`. The app registers `PUBLIC_BASE_URL/api/webhooks/lnbits/<secret>` as the invoice webhook.
3. A payment body with `pending: true` does not confirm a booking. A paid notice whose secret matches confirms it.

You choose the sats rate. The app does not look up an exchange rate.

## Door controller

`DOOR_BACKEND=mock` records pulses in memory and unlocks nothing physical. Use it for development.

`DOOR_BACKEND=http` POSTs JSON to `DOOR_HTTP_URL`:

```json
{
  "command": "pulse-entry",
  "area": "lounge",
  "pulseMs": 3000,
  "requestId": "aud_…"
}
```

The request uses `Authorization: Bearer <DOOR_HTTP_TOKEN>`, does not follow redirects, and is not retried. A failed pulse is written as `door-failed`. Retrying later could open the door after the member has walked away.

### Example relay

[`examples/http-relay/server.mjs`](examples/http-relay/server.mjs) is the contract, not a GPIO driver. It accepts `pulse-entry` and rejects every other command, including lock, fire release, and egress.

```bash
RELAY_TOKEN="$(openssl rand -hex 24)" RELAY_HOST=127.0.0.1 RELAY_PORT=8787 node examples/http-relay/server.mjs
```

Point the app at it with `DOOR_BACKEND=http`, `DOOR_HTTP_URL=http://127.0.0.1:8787/pulse`, and the same token in `DOOR_HTTP_TOKEN`. Keep that port off the public internet. Wire a real board only to an entry strike. Exit hardware stays on another circuit.

## Docker Compose

```bash
cp .env.example .env
# set CURRENCY, CURRENCY_DECIMALS, ADMIN_TOKEN, and PUBLIC_BASE_URL
docker compose up --build
```

SQLite lives in the `club-data` volume at `/data/club.sqlite`.

The example relay is a separate profile and is not published on the host:

```bash
# .env also needs DOOR_BACKEND=http,
# DOOR_HTTP_URL=http://entry-relay:8787/pulse,
# and DOOR_HTTP_TOKEN
docker compose --profile relay up --build
```

Put TLS in front of the club-box port (Caddy, nginx, or similar). Set `PUBLIC_BASE_URL` to that HTTPS origin and `TRUST_PROXY=true` only if the proxy overwrites `X-Forwarded-For`.

## Offline and fallback

- Booking and enrollment need the server. A player who cannot reach it cannot hold a slot.
- Door checks use the local SQLite file. They do not call out to a wallet service. The wallet only needs to reach `PUBLIC_BASE_URL` to POST its signature.
- If the kiosk page cannot load, or the controller does not answer, staff use fobs, PIN, or the door in person. The software does not store a "unlock later" queue.
- Egress never depends on this process.

## Production notes

- Run one app instance per SQLite file. The double-booking guard is a transaction on that file.
- Back up the database. It holds slots, invoices ids, linking public keys, and the access log.
- Review the access log. Rows older than `LOG_RETENTION_DAYS` are deleted.
- Linking keys are site-specific public keys. The app does not ask for an email address or a legal name.
- Confirm your insurer is comfortable with wallet-based entry and any unstaffed hours.
- Refunds are a desk decision. This app records settlement; it does not send sats back.
