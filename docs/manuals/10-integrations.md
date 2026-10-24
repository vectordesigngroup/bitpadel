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

Receipts, privacy links, household notices, and admin alerts are transactional. They do not look at the marketing checkbox. They also do not send a breach notice. **Not yet implemented:** breach notification.

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

The command does not copy `PHOTO_DIR`. Copy that directory with the same schedule. **Not yet implemented:** an encrypted backup or a cron container in Compose.

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

Fail-secure versus fail-safe is the installer's wiring choice. This software does not decide it and does not hold a pin active after the pulse.

GPIO and serial need a real machine to prove the hardware. The tests prove the software sends a pulse and then idle, and that `onoff` is absent in this environment.

## Payments

`PAYMENT_BACKEND` is `mock`, `btcpay`, or `lnbits`. Invoice creation is unchanged.

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

`GET /api/health` stays public. It adds `emailProvider`, `smsProvider`, `storageBackend`, and `backupDestination`. It does not include tokens, balances, or member data.

## What is stubbed

`npm run card:desfire` exits with a not-implemented message. `DesfirePersonalizer` and `DesfireReaderBridge` in `src/nfc/desfire-stub.ts` throw the same. They need a reader and card keys on a bench machine this repository does not drive. Server-side DESFire proof verification is unchanged and is not a stub.

A serial port and a GPIO pin are implemented as drivers and covered with fakes. Proving them on a club door still needs the hardware.
