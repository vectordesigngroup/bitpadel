# Installation and setup

How to stand up the reference app from this repository. Local rules, permits, and the physical door are outside the software. Use the [pilot checklist](../02-pilot-checklist.md) with your landlord, permitting office, insurer, and attorney. Use the [door hardware section](../../reference/club-box/README.md#compatible-door-hardware) with a licensed installer and the AHJ.

## Hardware by category

No prices and no catalog numbers beyond names already used in this repo as category examples. Those examples are not certifications and not a preferred-vendor list.

| Category | What the repo expects |
|---|---|
| Court | A place to play. The pilot checklist says to confirm the current federation size and clearances. It names a regulation padel court as 20 m × 10 m as a figure to check, not as a purchase order. |
| Club computer | Any machine that runs Node.js 22.13 or newer, or Docker. One process per SQLite file. A small always-on computer is enough for this app. No specific model is specified. |
| Kiosk screen | A browser on the club network that can open `/kiosk`. No specific tablet is specified. |
| Desk computer | A browser that can open `/desk` and `/admin`. |
| Lightning | Either no node (`PAYMENT_BACKEND=mock`), or BTCPay Server, or LNbits, running somewhere the app can reach. This repo does not ship a Lightning node. |
| Door lock | Electric strike, magnetic lock, or electrified mortise or cylindrical lockset, chosen by the locksmith under code. Fail-secure stays locked without power. Fail-safe unlocks without power. That choice is a code decision. |
| Request-to-exit and fire release | Required on the lock circuit where code says so. They are not connected to this software. |
| Relay | A private-network device that accepts the HTTP `pulse-entry` body, or the example process in `examples/http-relay`. Shelly-class and ESP32-class boards, and Wiegand or OSDP controllers, are named only as examples of a category. |
| Power for the lock | A supply sized for the lock, plus battery backup if the code or the insurer expects the entry side to ride through an outage. The app does not monitor that supply. |
| Fallback entry | Fob, PIN, or staff. Not implemented in this app. Required so a dead server does not trap people outside, and never required for leaving. |
| NFC cards | NTAG 424 DNA for the programming command. Factory keys are 16 zero bytes and must be changed before the card is a credential. DESFire EV2 or EV3 can be enrolled as a scheme. This repo does not personalize them. |
| NFC reader | A PC/SC reader on the programming computer. The card-programming doc names ACR122U-class and ACR1252-class readers as examples of that category. The server image does not include `pcscd`. A phone that opens the card URL is the other reader. |
| Network | Internet so phones and BTCPay or LNbits can reach `PUBLIC_BASE_URL`. The relay stays on a private network. TLS is terminated in front of the app. **Not yet implemented:** a proxy container in this Compose file. |
| Playtomic | No extra hardware. A Champion or Master plan and API credentials. Optional. |

## Server setup without Docker

From `reference/club-box`:

```bash
cp .env.example .env
npm ci
npm run dev
```

Production after a build:

```bash
npm run build
npm start
```

`npm start` runs `node dist/index.js`. You must set `CURRENCY`, `CURRENCY_DECIMALS`, and `ADMIN_TOKEN` (at least 16 characters). Generate the token locally, for example `openssl rand -hex 24`. Do not commit `.env`.

The process listens on `HOST` and `PORT` (default `127.0.0.1:3000`). SQLite is created at `DATABASE_PATH` (default `./data/club.sqlite`).

## Docker Compose

The Compose file builds the image from `reference/club-box/Dockerfile` (Node 22), publishes port 3000, sets `HOST=0.0.0.0` and `DATABASE_PATH=/data/club.sqlite`, and stores SQLite on the volume `club-data`. Restart policy is `unless-stopped`. A health check calls `GET /api/health`.

```bash
cp .env.example .env
# set CURRENCY, CURRENCY_DECIMALS, ADMIN_TOKEN, and PUBLIC_BASE_URL
docker compose up --build
```

The example relay is profile `relay`. It is not published on the host. It runs `examples/http-relay/server.mjs` inside a Node 22 image and listens on port 8787 inside the Compose network. It still does not toggle GPIO.

```bash
# .env: DOOR_BACKEND=http
# DOOR_HTTP_URL=http://entry-relay:8787/pulse
# DOOR_HTTP_TOKEN matches RELAY_TOKEN, which Compose reads from DOOR_HTTP_TOKEN
docker compose --profile relay up --build
```

Put TLS in front (the club-box README names Caddy or nginx as examples). Set `PUBLIC_BASE_URL` to that HTTPS origin. Set `TRUST_PROXY=true` only when that proxy sets `X-Forwarded-For`.

Photos in Docker default to a `photos` directory next to `/data/club.sqlite`, which is on the same volume. Set `PHOTO_DIR` if you want a different path. The variable is read by the app and is not listed in `.env.example`.

## Environment

Copy [`.env.example`](../../reference/club-box/.env.example). The [configuration table](../../reference/club-box/README.md#configuration) is the full list. Minimum for a mock laptop:

| Variable | Value |
|---|---|
| `CURRENCY` | Your 3-letter code |
| `CURRENCY_DECIMALS` | Often `2` |
| `ADMIN_TOKEN` | Long random string |
| `PAYMENT_BACKEND` | `mock` |
| `DOOR_BACKEND` | `mock` |
| `PUBLIC_BASE_URL` | The origin phones will call |

Leave Playtomic ids empty until you intend to sync. Leave NFC keys empty until you issue cryptographic cards. `NFC_UID_MODE` stays `off`.

## BTCPay, LNbits, or mock

| Backend | Use it when | What you must set | How a booking confirms |
|---|---|---|---|
| `mock` | Practice and automated tests | Nothing else | Admin **Simulate payment**. The invoice is not payable. |
| `btcpay` | You run BTCPay Server and want the invoice in `CURRENCY` | `BTCPAY_URL`, `BTCPAY_STORE_ID`, `BTCPAY_API_KEY`, `BTCPAY_WEBHOOK_SECRET`, and usually `BTCPAY_PAYMENT_METHOD` (`BTC-LN`, or `BTC-LightningNetwork` on some servers) | Webhook `POST /api/webhooks/btcpay`. Signature must match. `InvoiceSettled` confirms. `InvoiceExpired` and `InvoiceInvalid` release the hold. |
| `lnbits` | You run LNbits and you pick the sats rate yourself | `LNBITS_URL`, `LNBITS_INVOICE_KEY`, `LNBITS_WEBHOOK_SECRET` (16–128 characters from letters, digits, underscore, hyphen), `SATS_PER_MINOR_UNIT` | The app registers `PUBLIC_BASE_URL/api/webhooks/lnbits/<secret>`. `pending: true` does not confirm. A paid notice whose secret matches does. |

Hosted Lightning processors are mentioned in [Lightning integrations](../04-lightning-integrations.md) as a category. **Not yet implemented:** a hosted-processor adapter in this app.

Test with small payments before opening day. The app does not look up an exchange rate.

## Door relay

Summary only. The installer owns the wire.

1. This process sends one JSON command, `pulse-entry`, with `area`, `pulseMs` (`DOOR_PULSE_MS`, default 3000, range 200–10000), and `requestId`.
2. Header `Authorization: Bearer <DOOR_HTTP_TOKEN>`. Redirects are not followed. The call is not retried.
3. The example relay rejects every command other than `pulse-entry`, including lock, fire, and egress.
4. Connect the relay coil to the entry side only. Request-to-exit and fire-alarm release stay on circuits this process cannot reach.
5. Keep the relay off the public internet.

`DOOR_BACKEND=mock` records a pulse in memory and moves no hardware.

## NFC reader setup

On the computer that programs cards or runs the bridge, not on the club server image:

1. Install the `pcscd` service and the optional `pcsclite` Node module. The server does not import them until `npm run card:program` or `npm run reader:bridge` runs without `--dry-run`.
2. Create a master key and an SDM meta-read key locally. Put them in `NFC_MASTER_KEY` and `NFC_SDM_META_READ_KEY`, or in a JSON file named by `NFC_KEYS_FILE`. The names `nfc-keys.json` and `*-nfc-keys.json` are gitignored.
3. Dry-run first. It uses an in-memory card and does not enroll:

```bash
npm run card:program -- --dry-run --uid 04DE5F1EACC040 --area lounge
```

4. Program and enroll with a real reader using the steps in [card programming](../nfc-card-programming.md).
5. At the kiosk machine, `npm run reader:bridge` reads the NDEF URL and requests it. Keys stay on the server.

## First-run checklist

1. Process starts and `GET /api/health` returns `"ok": true`.
2. Admin loads with the admin token.
3. Add one court and one slot with a price you chose.
4. Hold the slot on `/`. On mock, simulate payment and see one booking. Download the CSV and confirm the minor-unit amount.
5. Add a member, enroll a wallet or a programmed card, and unlock once on the kiosk. The access log gains a row. The desk shows the visit.
6. Check out from the desk.
7. Confirm the kiosk still shows the entry-only and free-egress lines with JavaScript disabled (the noscript text) and when you stop the server (the unreachable text).
8. If Playtomic is configured, **Sync now**, map one resource id, and confirm an imported block on `/` has no email address.

## Go-live acceptance test

Do this on the hardware and the payment backend you will actually use. Mock mode is not a go-live result.

- [ ] `PUBLIC_BASE_URL` is the HTTPS origin a phone on the club network can open.
- [ ] A real Lightning invoice for a cheap test slot settles once, the slot becomes booked, and a second notice does not create a second booking.
- [ ] An unpaid hold expires and the slot can be held again. A late settlement does not book it.
- [ ] Two people cannot hold the same open slot.
- [ ] A Playtomic-covered time cannot be held, if you enabled sync and mapped the court.
- [ ] An enrolled wallet pulses entry once. A second scan of the same QR does not.
- [ ] A revoked member and a lost card do not pulse entry.
- [ ] Outside the hours in `ACCESS_AREA_HOURS`, the area does not pulse. Empty hours means the area is allowed whenever the server is up.
- [ ] Unplugging the relay produces `door-failed` and does not queue a later pulse.
- [ ] The exit works with the server stopped and with mains power removed, using the hardware your installer and AHJ approved.
- [ ] A person who did not check the marketing box is absent from `GET /api/admin/marketing.csv`.
- [ ] `/api/health` shows `controlsEgress` false and `controlsLifeSafety` false.
- [ ] Secrets are only in `.env` or the key file, not in git.

Insurer questions about wallet entry and unstaffed hours are in the [pilot checklist](../02-pilot-checklist.md). This test does not replace that conversation.
