# Developer and contributor manual

How the reference app is put together, and how to change it without inventing a second product. Contributor rules are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md): no personal data, no secrets in git, no investment language, and door safety stays entry-only.

Docs in this folder are CC BY-SA 4.0, with the other playbooks. Code under `reference/club-box` is AGPL-3.0-only. See the [licenses](../../README.md#license).

## Architecture

One Node.js process serves the pages and the JSON API. SQLite (`better-sqlite3`) is the database. Payment processors and the door are adapters. Playtomic is an optional read-only client. NFC cryptography runs in-process. The phone or the reader bridge only delivers a URL or a proof. Keys stay on the server.

```
browser pages (public/)
    │
    ▼
HTTP routes ── booking service ── payment adapter (mock | btcpay | lnbits)
    │                │
    │                └── slots, holds, bookings
    ├── LNURL-auth and NFC entry ── door adapter (mock | http pulse-entry)
    ├── check-in, guests, privacy
    └── Playtomic sync ── external_bookings block overlapping holds
```

Startup is `src/index.ts`: load config, open the database, release expired holds, expire stale check-ins, purge old rows, listen, then run the 15-second sweep, the hourly retention sweep, and the Playtomic timer.

`GET /api/health` is the liveness check used by the Docker `HEALTHCHECK`. It does not require a token.

The double-booking guard is a transaction on one SQLite file. Do not run two processes on that file.

## Repository layout

| Path | What it is |
|---|---|
| `docs/01` through `docs/08` | Playbooks. Not all of them have code. |
| `docs/nfc-card-programming.md` | NTAG 424 DNA procedure. |
| `docs/manuals/` | These manuals. |
| `docs/ROADMAP.md` | Done and not done. |
| `templates/` | Financial model, founding-member page, run-of-show, sponsor one-pager, privacy notice. |
| `brand/` | Placeholder look for the kit. Club-box reads its own saved brand from the database. |
| `reference/club-box/src/brand/` | Club name, logo, colors, CSS variables, and email branding. |
| `reference/club-box/src/i18n/` | Locale choice, catalogs, and `Intl` dates, money, and sats. |
| `reference/club-box/locales/` | Message catalogs. `en.json` is the source. See [`docs/translations.md`](../translations.md). |
| `reference/club-box/src/routes.ts` | Health, courts, slots, holds, webhooks, LNURL-auth, admin courts and members. |
| `reference/club-box/src/routes-access.ts` | NFC taps, check-in, guests, photos, cards, households, marketing, privacy. |
| `reference/club-box/src/routes-playtomic.ts` | Calendar blocks, maps, sync, conflicts, today's staff list. |
| `reference/club-box/src/payments/` | `PaymentBackend` and the three adapters. |
| `reference/club-box/src/doors/` | `pulse-entry` only. |
| `reference/club-box/src/nfc/` | AES-CMAC, SUN, EV2 framing, NDEF, simulator, programmer, bridge. |
| `reference/club-box/src/playtomic/` | Token cache, GET bookings, GET payments, upserts. |
| `reference/club-box/src/checkin/` | Visits, guests, consent, on-site list. |
| `reference/club-box/public/` | Booking, admin, kiosk, desk, guest, privacy, enroll. `i18n.js` formats dates and money. `brand.js` fills the header from `/api/brand`. |
| `reference/club-box/examples/http-relay/` | Contract relay. No GPIO. |
| `reference/club-box/test/` | Node's test runner via `tsx`. |

## Run the tests

From `reference/club-box`, with Node.js 22.13 or newer:

```bash
npm ci
npm test
npm run typecheck
```

`npm test` runs `tsx --test test/*.test.ts`. Tests use an ephemeral SQLite file and a fixture amount of one minor unit. That number is not a price. The Playtomic tests start a local mock HTTP server. NFC tests use published AN10922 and AN12196 vectors, including an all-zero SUN example. Those values are test vectors, not club keys.

`npm run dev` is the mock-friendly server. `npm run build` compiles TypeScript to `dist/`. `npm start` runs the compiled server.

There is no separate test framework config and no browser test suite in the repo. **Not yet implemented:** CI config checked in as a required gate. Run the two commands above before you open a pull request.

## Add a payment backend

The union is `PaymentBackendName` in `src/config.ts` (`mock`, `btcpay`, `lnbits`). The interface is `src/payments/types.ts`: `createInvoice`, `interpretWebhook`, `refund`, and `health`. A backend that cannot refund returns `{ supported: false, reason }` with a clear "not supported by this backend" reason, or throws `PaymentError` when the call itself fails.

1. Add the name to the union and to the allowed-values list in `src/config.ts`.
2. Parse any new environment variables only when that backend is selected. Do not require them for `mock`.
3. Implement the interface in `src/payments/`.
4. Add a branch in `createPaymentBackend`. Keep the `never` check in the default branch so a new name fails the build until it is handled.
5. Map settlement to `kind: "settled"` and expiry to `kind: "expired"`. Anything else is `ignore`. Do not confirm a booking on a pending notice.
6. Add tests beside `test/settlement.test.ts`. Use a tiny fixture amount.
7. Document the variables in `.env.example` and in the club-box README. Do not add a hard-coded price.

Email, SMS, storage, backup destinations, and door drivers follow the same pattern. The operator steps are in [integrations](10-integrations.md). `npm run card:desfire` is a stub. DESFire personalization and a DESFire reader bridge are interfaces that throw "not implemented". NTAG 424 programming and server-side DESFire proof checks stay as they are.

Webhooks must check a secret (HMAC for BTCPay, path secret for LNbits). Follow redirects nowhere on the door client. Payment HTTP helpers live in `src/payments/http.ts`.

## Add an NFC card type

Existing presentations are `sun`, `desfire`, and `uid-insecure`. The switch in `src/nfc/entry.ts` ends with a `never` default. Enrollment schemes are `ntag424-sun`, `desfire`, and `uid-insecure` in `routes-access.ts`.

1. Extend the presentation type and handle it in that switch. A missing case should fail typecheck.
2. Reject the scheme unless the server has the keys it needs. UID-only stays behind `NFC_UID_MODE=insecure-dev`.
3. Store a rolling counter if the scheme has one, and refuse replays.
4. The programming CLI (`src/nfc/program-cli.ts`) writes NTAG 424 DNA only. A new chip needs its own programmer. Do not pretend the dry-run simulator is that chip.
5. The reader bridge only reads an NDEF URL. A card that does not speak NDEF needs a different bridge. `DesfireReaderBridge` in `src/nfc/desfire-stub.ts` is that extension point and currently throws. Say so in `docs/nfc-card-programming.md`.
6. Add vectors you can cite. Do not invent a certification.

Door behavior stays `pulse-entry`. Do not add a lock command to make the new card "more useful."

## Versioning and releases

The package version is `0.1.0` in `reference/club-box/package.json`. The kit status line in the root README says early draft v0.1. The roadmap is the change list.

**Not yet implemented:** a changelog file, git tags as a required step, a publish pipeline, or semantic-release automation.

When you do cut a change:

1. Update the roadmap so operators can see what landed.
2. If you change an environment variable, update `.env.example` and the configuration table in `reference/club-box/README.md`.
3. If you change a staff-visible page, update the matching manual in `docs/manuals/` in the same pull request. Manuals are supposed to match the code. If a feature is missing, write **not yet implemented** instead of describing it as if it shipped.
4. Run `npm test` and `npm run typecheck`.
5. Open a pull request. Do not commit secrets, real member data, or club prices.

Database changes belong in `src/db.ts`. New columns on existing tables go through `ensureColumn` so an old `club.sqlite` still opens. There is no separate migration runner.

## Conventions that keep the door safe

- Default the door and payment adapters to `mock`.
- The example relay returns an error for any command other than `pulse-entry`.
- Health JSON keeps `controlsEgress` and `controlsLifeSafety` false.
- Public calendar blocks use the label "Imported booking" and do not include player email.
- Marketing rows are written only for an explicit opt-in or Playtomic `accepts_commercial_communications === true`.
