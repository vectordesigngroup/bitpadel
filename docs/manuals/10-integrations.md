# Integrations

How a club points this app at its own email, SMS, photo storage, backups, door hardware, and Lightning backend. Secrets stay in the environment. `.env.example` lists the names with empty values. Do not commit a filled-in `.env`.

The default for a fresh checkout is safe for tests: console email, console SMS, local photos, local backups, and the mock door. Nothing is delivered and no pin is toggled until you change those variables and restart.

## Add your own provider

Each integration is an interface plus a switch in a `create*` function. The `never` branch fails the build until a new name is handled.

| Integration | Interface | Switch |
|---|---|---|
| Email and SMS | `MessageProvider` in `reference/club-box/src/notify/types.ts` | `createNotifier` in `src/notify/index.ts` |
| Photos | `ObjectStorage` in `src/storage/types.ts` | `createStorage` in `src/storage/index.ts` |
| Backups | `BackupDestination` in `src/backup/destination.ts` | `destinationFrom` in `src/backup/cli.ts` |
| Doors | `DoorController` in `src/doors/types.ts` | `openDoorController` in `src/doors/index.ts` |
| Payments | `PaymentBackend` in `src/payments/types.ts` | `createPaymentBackend` in `src/payments/index.ts` |
| Cards | `CardProvider` in `src/payments/cards/types.ts` | `createCardSet` in `src/payments/cards/index.ts` |

To add one:

1. Implement the interface in a new file. Keep vendor SDKs out unless you want that dependency. The shipped HTTP providers use `fetch`.
2. Add the name to the union and the allowed list in `src/config.ts`. Parse secrets only when that name is selected.
3. Handle the name in the switch. Leave the `never` default in place.
4. Add a test that injects a fake transport. Do not call a real vendor from `npm test`.
5. Document the variables in `.env.example` and on this page.

Providers do not check marketing consent. `sendMarketing` in `src/notify/service.ts` does. Call that for campaigns. Call `sendTransactional` for receipts, privacy links, household notices, and admin alerts.

## Email

`EMAIL_PROVIDER` is `console`, `smtp`, or `postmark`.

| Value | What it uses |
|---|---|
| `console` | Writes a redacted log line. Nothing is delivered. |
| `smtp` | Nodemailer. Set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. |
| `postmark` | `POST https://api.postmarkapp.com/email` with `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM`. No Postmark SDK. |

`NOTIFY_ADMIN_EMAIL` receives transactional alerts when an entry pulse fails or a Playtomic sync fails. Leave it empty to skip email alerts.

A booking receipt is sent only when the player typed a receipt email on the booking page. The hold stores that address. No address means no receipt.

## SMS

`SMS_PROVIDER` is `console`, `twilio`, or `webhook`.

| Value | What it uses |
|---|---|
| `console` | Redacted log line. Nothing is delivered. |
| `twilio` | Twilio's Messages API with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM`. No Twilio SDK. |
| `webhook` | `POST` JSON `{ to, text, kind }` to `SMS_WEBHOOK_URL`. `SMS_WEBHOOK_TOKEN` is an optional bearer token. |

`NOTIFY_ADMIN_SMS` is the transactional alert number. A guest privacy link uses SMS when the guest form collected a phone.

## Marketing versus transactional

Marketing is `POST /api/admin/marketing/send` and the Admin button **Send to opted-in contact**. The contact must have a marketing row with `unsubscribed_at` empty. Otherwise the response is "That contact has not opted in to marketing".

Receipts, privacy links, household notices, booking reminders, login codes, the daily sales email, and admin alerts are transactional. They do not look at the marketing checkbox. A booking reminder is sent only when the player checked that box at checkout. Login codes and reminders are not marketing. They also do not send a breach notice. **Not yet implemented:** breach notification.

## Photos

`STORAGE_BACKEND=local` writes under `PHOTO_DIR`, or `photos` next to the database. `memory` keeps bytes in the process and drops them on restart. Use `memory` for tests.

`PHOTO_MAX_BYTES` defaults to 1048576. The HTTP body limit is 2 MB, so a larger cap will fail before the file is stored. Allowed types are JPEG, PNG, and WebP, checked by content type and file header.

An S3 photo adapter is the same `ObjectStorage` interface. It is not shipped. Backup S3 is separate and is shipped.

## Backups

```bash
npm run backup -- backup
npm run backup -- restore --from ./data/backups/club-....sqlite --force
npm run backup -- restore --name club-....sqlite --force
```

`backup` opens `DATABASE_PATH` and uses SQLite's online backup, then copies the snapshot. The server can keep running for that command.

`restore` overwrites `DATABASE_PATH`. Stop the server first. `--force` is required when the file already exists. The command deletes leftover `-wal` and `-shm` files so SQLite does not replay them over the restored copy.

`BACKUP_DESTINATION=local` uses `BACKUP_DIR` (default `./data/backups`). `s3` uses path-style requests to `S3_ENDPOINT` with `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optional `S3_PREFIX`. There is no AWS SDK.

This process does not run cron. Put the backup command in the host crontab. A daily example, with your path:

```cron
0 3 * * * cd /opt/club-box && npm run backup -- backup
```

The command does not copy `PHOTO_DIR`. Copy that directory with the same schedule. **Not yet implemented:** a cron container in Compose.

Set `BACKUP_PASSPHRASE` (at least 12 characters) to encrypt the snapshot with AES-256-GCM. The file name ends in `.sqlite.enc`. Restore uses the same passphrase. A missing or wrong passphrase stops the restore and does not write the database. Leave the variable empty to keep the plain SQLite copy. The passphrase is not stored in the database and is not written into the backup.

The CLI does not load `ADMIN_TOKEN`. It only needs the database path and the backup destination variables.

## Doors

`DOOR_BACKEND` is `mock`, `http`, `gpio`, or `serial`.

Every driver implements `pulseEntry` only. There is no lock, hold-shut, or fire-release method. `controlsEgress` and `controlsLifeSafety` stay false. People leave through hardware this process cannot reach. Fire-alarm release is wired at the hardware level, on a circuit the software does not pulse. The software never blocks egress. It only pulses entry, then returns a GPIO pin to its idle level or writes a single `pulse-entry` line.

| Value | Notes |
|---|---|
| `mock` | Records the pulse in memory. Tests use this. |
| `http` | `POST` `{ command: "pulse-entry", area, pulseMs, requestId }` to `DOOR_HTTP_URL` with `DOOR_HTTP_TOKEN`. No redirects and no retries. The example relay rejects any other command. |
| `gpio` | Optional `onoff` package on the host that owns the pin. Set `DOOR_GPIO_PIN` and `DOOR_GPIO_ACTIVE_HIGH` (default true). The server image does not install `onoff`. If the package is missing, startup fails with that reason. Tests inject a fake pin and do not load `onoff`. |
| `serial` | Writes one `pulse-entry` line to `DOOR_SERIAL_PATH`. It does not send lock or fire. |

`DOOR_PULSE_MS` is the pulse length, from 200 to 10000.

`BOOKING_ENTRY=false` is the default. The kiosk refuses a new challenge when the area is outside `ACCESS_AREA_HOURS`. Set it to `true` and a confirmed booking also allows the entry pulse from `BOOKING_ENTRY_BEFORE_MINUTES` before the slot (default 30) through `BOOKING_ENTRY_AFTER_MINUTES` after it (default 15), including unstaffed hours. The audit reason is `booking-window`. A member created from a player email, with access scope `booking`, can use that window only. An existing member keeps area hours as well. Leaving and fire release stay on hardware. The software still only pulses entry.

Fail-secure versus fail-safe is the installer's wiring choice. This software does not decide it and does not hold a pin active after the pulse.

GPIO and serial need a real machine to prove the hardware. The tests prove the software sends a pulse and then idle, and that `onoff` is absent in this environment.

## Payments

`PAYMENT_BACKEND` is `mock`, `btcpay`, or `lnbits`. That choice is the Lightning backend. It stays one of those three.

`CARD_PROVIDERS` is a comma list of `stripe`, `square`, or both. Empty, the default, means the booking page offers Lightning only. A player chooses Lightning or one enabled card provider. The hold stores `payment_method`. Card checkout URLs are the provider's hosted page. The booking confirms when the signed webhook arrives.

| Provider | Checkout | Webhook | Refund |
|---|---|---|---|
| Stripe | `POST /v1/checkout/sessions` | `POST /api/webhooks/stripe`, `checkout.session.completed` with `payment_status=paid`. The header is `Stripe-Signature` (`t=`, `v1=` HMAC). | `POST /v1/refunds` using the payment intent stored from that webhook. Until the webhook arrives, the refund is "Not supported by this backend until the Stripe webhook stores the payment intent." |
| Square | `POST /v2/online-checkout/payment-links` (`quick_pay`) | `POST /api/webhooks/square`, `payment.updated` or `payment.created` with status `COMPLETED`. The header is `x-square-hmacsha256-signature` over the notification URL plus the body. | `POST /v2/refunds` using the Square payment id from that webhook. Until then, the refund is "Not supported by this backend until the Square webhook stores the payment id." |

`STRIPE_SECRET_KEY` must start with `sk_test_` unless `STRIPE_ALLOW_LIVE=true`. `SQUARE_ENV` defaults to `sandbox` (`connect.squareupsandbox.com`). `production` also requires `SQUARE_ALLOW_LIVE=true`. Optional `STRIPE_API_BASE` and `SQUARE_API_BASE` must be `https` or `http://127.0.0.1`. Do not commit keys. Public `/api/health` lists the provider names and does not call them.

Stripe Checkout sessions last at least 30 minutes on Stripe's side. The club hold timer is still the one that releases the slot. A webhook that arrives after the hold expired does not book the court.

Sales CSV and **End of day** include `lightning`, `stripe`, and `square`, including bookings a player later cancelled, plus refund rows.

### Square Bitcoin is in-person only

Square's online APIs do not create a Bitcoin or Lightning payment. This app does not add a "Bitcoin via Square" checkout option and does not send a Bitcoin flag to Square.

What Square documents:

- [Accept and manage bitcoin payments](https://squareup.com/help/us/en/article/8622-accept-and-manage-bitcoin-payments). Bitcoin is taken in the Square POS app (the seller shows a Lightning QR) and on Square Register (the buyer can pick Bitcoin on the customer-facing display). NFC tap is only on Square Register (2nd generation). It is not available on Square Terminal, Square Stand, or the mobile app. Eligible US businesses, not businesses or locations in New York. The processing fee is 0% until December 31, 2026, then 1%. The maximum is the bitcoin market equivalent of $600 per transaction and $20,000 per day. Refunds are issued only from the Square POS app, as a gift card for the dollar amount, not as a Lightning reversal. Bitcoin is not compatible with invoices that allow partial payments. Square does not handle disputes for these payments.
- [Checkout API](https://developer.squareup.com/docs/checkout-api). `CreatePaymentLink` payment methods are credit and debit cards, Google Pay, Apple Pay, Afterpay, and Cash App. The same list is in the [v1 checkout migration guide](https://developer.squareup.com/docs/migrate-from-v1/guides/v1-checkout).
- [Web Payments SDK](https://developer.squareup.com/docs/web-payments/overview). Tokens come from credit card, gift card, digital wallets, ACH, Afterpay, and Cash App Pay.
- [Create payment](https://developer.squareup.com/reference/square/payments-api/create-payment). `source_id` is one of those tokens, or `CASH` or `EXTERNAL` for a payment taken outside Square. It does not create a Lightning invoice.
- [LightningDetails](https://developer.squareup.com/reference/square/objects/LightningDetails). A read-only `payment_url` on a Payment that already has `source_type` WALLET and brand LIGHTNING. That is a reporting shape for a payment that already happened, not a call that creates one.
- [International development](https://developer.squareup.com/docs/international-development). Square payment processing is available in Australia, Canada, France, Ireland, Japan, Spain, the United Kingdom, and the United States. The Bitcoin feature above is the US in-person feature, excluding New York, not a method on the online APIs.

A club that wants Bitcoin at the pro-shop counter uses Square's own Register or POS app on Square hardware, in an eligible US location outside New York. Online court checkout in this app stays the club's Lightning backend or the card providers above. Square's gift-card refund for an in-person Bitcoin sale is done in the Square POS app. This app does not record or reverse that sale.

Card processing and refunds need the club's attorney and CPA before live keys are turned on. Test and sandbox modes are the default.

## Lightning refunds

Lightning invoice creation is unchanged.

Refunds are `POST /api/admin/bookings/<id>/refund` with `{ reason, bolt11? }`, or **Refund** on the booking in Admin.

| Backend | Refund |
|---|---|
| `mock` | Records a refund id. No sats move. |
| `btcpay` | `POST /api/v1/stores/{storeId}/invoices/{invoiceId}/refund`. A failed call is a payment error, not a fake success. |
| `lnbits` | Pays `bolt11` with `out: true`. Without that invoice the result is "Not supported by this backend without a customer BOLT11." |

Admin **Check Lightning balance** calls `health()`. LNbits reads the wallet balance in sats when the invoice key can. BTCPay tries the store Lightning balance endpoint and returns the error text if it cannot. Mock has no balance. Public `/api/health` lists provider names only.

## Staff accounts

`POST /api/session/login` with `{ username, password }` returns a session token and sets cookie `club_session`. Passwords are scrypt hashes. Sessions store the SHA-256 of the token and expire after `SESSION_TTL_HOURS`.

`STAFF_BOOTSTRAP_USERNAME`, `STAFF_BOOTSTRAP_PASSWORD` (at least 12 characters), and optional `STAFF_BOOTSTRAP_NAME` create an owner on startup when that username is absent. Leave them empty in git. Rotate or disable the account after first use if the password lived in a shell history.

`ADMIN_TOKEN` still has every permission. `STAFF_TOKEN` still has desk access only. Those tokens are the migration path. Named roles are owner, manager, front-desk, and coach. Coach matches front desk: the desk, not Admin.

## Logging and health

`LOG_FILE` empty means stdout and stderr only. A path also appends JSON lines and rotates at `LOG_FILE_MAX_BYTES`, keeping `LOG_FILE_KEEP` older files.

`GET /api/health` stays public. It adds `emailProvider`, `smsProvider`, `storageBackend`, `backupDestination`, `cardProviders`, and `bookingEntry`. It does not include tokens, balances, or member data.

## What is stubbed

`npm run card:desfire` exits with a not-implemented message. `DesfirePersonalizer` and `DesfireReaderBridge` in `src/nfc/desfire-stub.ts` throw the same. They need a reader and card keys on a bench machine this repository does not drive. Server-side DESFire proof verification is unchanged and is not a stub.

A serial port and a GPIO pin are implemented as drivers and covered with fakes. Proving them on a club door still needs the hardware.
