# Maintenance manual

Schedules for the reference app and for the door categories in the [hardware guide](../../reference/club-box/README.md#compatible-door-hardware). Record the work on the [maintenance log](maintenance-log.md).

Jobs the software does by itself:

- About every 15 seconds: expire unpaid holds and check out visits older than `CHECKIN_STALE_MINUTES`.
- About every hour, and once at startup: delete access-log rows and old challenges past `LOG_RETENTION_DAYS`, and delete old check-ins, imported bookings, and resolved conflicts past `VISIT_RETENTION_DAYS`.
- If Playtomic sync minutes are greater than zero: sync on that interval, and once at startup.

**Not yet implemented:** a maintenance scheduler, a backup command, email alerts, and a battery or lock-sensor reading.

## Daily

| Job | What to do |
|---|---|
| App up | Open `/api/health` or the kiosk. `"ok": true`. Read `paymentBackend` and `doorBackend`. |
| Desk | Load `/desk`. Check out people who left. Read conflicts. |
| Door entry | One real or test unlock. Confirm the strike releases and re-locks on its own. If the pulse fails, use the [door-fault card](quick-cards/door-fault.md). |
| Egress | Walk out without a phone or card. This is a building check, not an app feature. |
| Payments | If you took Lightning payments, confirm each one in Admin bookings, not from a screenshot. |
| Playtomic | If sync is on, confirm **Today's imported bookings** looks current. A stale list plus a log line `playtomic sync failed` means the timer is failing. **Sync now** shows an error on the admin status line. |

## Weekly

| Job | What to do |
|---|---|
| Access log | In Admin, skim `door-failed`, `unknown-key`, and `revoked`. |
| Holds | Confirm expired holds are not stuck. A stuck open slot that should be free can be canceled and recreated. There is no "repair hold" button. |
| Reader | Clean the NFC reader window the way the reader maker says. This repo has no cleaning spec. Power-cycle `pcscd` only on the programming or bridge computer if taps stop. |
| Disk | Confirm the volume that holds `DATABASE_PATH` and the photos directory is not full. The app does not warn you. |
| Updates | Read release notes for Node, BTCPay or LNbits, and this repo's [roadmap](../ROADMAP.md). Apply updates in a maintenance window, not during check-in. See "Software updates" below. |

## Monthly

| Job | What to do |
|---|---|
| Backup and restore drill | Take a backup, then restore it onto a spare machine or a spare volume and open `/api/health` and Admin. Do not drill on the live file. Steps are below. |
| Secrets | Confirm `.env` and `NFC_KEYS_FILE` are not in git (`git status` should not list them). |
| Marketing | Export `GET /api/admin/marketing.csv` only if you use it. Confirm people who unsubscribed are not in the file. |
| Playtomic token | Tokens last about an hour and refresh inside the client. You do not paste a bearer token by hand. If sync returns 401 after a refresh, the client id or secret is wrong or was regenerated in Playtomic (regenerating invalidates the old secret). |
| Liquidity | **Not yet implemented** inside this app. If you run a Lightning node under BTCPay or LNbits, check that product's own channel and balance screens so invoices can still be paid. This app cannot open or close a channel. |

## Quarterly

| Job | What to do |
|---|---|
| Restore timing | Write down how long the restore drill took. |
| Token rotation | Plan a rotation of `ADMIN_TOKEN`, `STAFF_TOKEN`, `DOOR_HTTP_TOKEN`, and webhook secrets if they have been shared more widely than you want. Rotation steps are in the [security manual](06-security-incident.md). |
| NFC keys | Confirm an offline copy of the master key and the meta-read key still opens. Do not email the file. Rotating keys is below. A lost master key means you cannot diversify replacements for cards already issued. |
| Door inspection | With the installer if you are not qualified: strike or maglock alignment, request-to-exit, fire-alarm release, and battery backup. The tests are the ones your AHJ and installer specified. This repo does not define pass/fail measurements. |
| TLS certificate | On the proxy in front of the app. **Not yet implemented:** certificate issuance in this repository. |

## Annual

| Job | What to do |
|---|---|
| Full restore | Restore last month's backup onto spare hardware and run the [go-live acceptance test](03-installation.md#go-live-acceptance-test) that does not move money, plus one small Lightning payment if you use a real backend. |
| Dependency update | Rebuild the Docker image (`docker compose up --build`) or `npm ci` from a lockfile you have reviewed. |
| Privacy text | If the waiver or marketing text changed, bump `WAIVER_TEXT_VERSION` or `CONSENT_TEXT_VERSION` so new rows record the new label. Old rows keep the old label. |
| Playbooks | Re-read the [pilot checklist](../02-pilot-checklist.md) insurance and fire items with your broker and AHJ. |

## Software updates

The app is updated by replacing this repository's `reference/club-box` code and rebuilding.

1. Read the change. Run `npm test` and `npm run typecheck` in `reference/club-box` before you deploy.
2. Back up the database and photos first.
3. On Docker: `docker compose up --build`. The volume `club-data` keeps `/data/club.sqlite`.
4. Without Docker: `npm ci`, `npm run build`, restart `npm start`.
5. Open `/api/health` and unlock once.

**Not yet implemented:** a one-command updater, migrations beyond what the process applies when it opens SQLite, and a signed release feed. Schema additions in this version run when the database opens (`ensureColumn` in `src/db.ts`).

Node.js on the host must stay at 22.13 or newer. The image pins Node 22.

## Backups and restore drills

What to copy:

- The SQLite file at `DATABASE_PATH`. In Compose that is `/data/club.sqlite` on volume `club-data`.
- The WAL and SHM files next to it if they exist (`*.sqlite-wal`, `*.sqlite-shm`). They are gitignored. A clean copy is easier if the process is stopped, because the app allows one writer and a live copy can be mid-transaction.
- The photos directory (`PHOTO_DIR`, or `photos` next to the database).
- An offline copy of `.env` and the NFC key file, stored with the same care as a door key. Do not put them in the same git repo.

**Not yet implemented:** `npm run backup`, a cron container, or encryption of the backup.

Restore drill:

1. Stop the app (`docker compose stop` or end the Node process). SIGINT and SIGTERM close the database.
2. Copy the live files to a spare folder. Start a second instance with `DATABASE_PATH` pointed at that spare folder and a different `PORT`. Do not point two processes at one file.
3. Check `/api/health`, a known member, and one historical booking.
4. Throw away the spare copy. Start the live process on the original path.

To restore after a real loss, stop the app, replace the database and photos with the backup, then start. Bookings created after the backup are gone. There is no merge tool.

## Log review

Application logs are one JSON object per line on stdout and stderr (`time`, `level`, `msg`). Docker captures them with `docker compose logs`. Useful messages:

| Message | Meaning |
|---|---|
| `listening` | Process started. Fields include backends and `controlsEgress: false`. |
| `entry pulsed` | A successful unlock. |
| `playtomic sync failed` | The timer threw. The error string is in the line. |
| `hold sweep failed` or `retention sweep failed` | The periodic job threw. |
| `payment notice` | A webhook was interpreted (`confirmed`, `already-confirmed`, `expired`, `ignored`). |

The member-facing history is Admin **Access log**, not the JSON lines. JSON lines are not deleted by `LOG_RETENTION_DAYS`. **Not yet implemented:** log rotation in the app. Rely on Docker or the host.

## Secret and certificate rotation

| Secret | Effect of replacing it |
|---|---|
| `ADMIN_TOKEN` | Old admin browsers stop working until someone pastes the new token. |
| `STAFF_TOKEN` | Desk browsers need the new token. |
| `DOOR_HTTP_TOKEN` | Must match the relay's `RELAY_TOKEN`. A mismatch is `door-failed` or HTTP 401 at the relay. |
| `BTCPAY_WEBHOOK_SECRET` | Must match the BTCPay webhook. Otherwise settlements are rejected. |
| `BTCPAY_API_KEY` | Invoice creation fails until it matches a key that can create invoices. |
| `LNBITS_INVOICE_KEY` and `LNBITS_WEBHOOK_SECRET` | New invoices use the new invoice key. The webhook path contains the secret, so update LNbits to the new URL the app registers. |
| `PLAYTOMIC_CLIENT_SECRET` | Next token request uses it. Regenerating in Playtomic invalidates the previous secret. |
| TLS certificate | On your proxy. Restart or reload that proxy. This app speaks HTTP behind it. |

Restart the app after `.env` changes. It reads the environment at startup only.

## NFC key management

Keys are 16 bytes of hex. Slot layout and AN10922 diversification are in [card programming](../nfc-card-programming.md).

- Keep the master key and the club-wide meta-read key on the server and in an offline backup.
- `NFC_TRANSPORT_KEY` is the key currently in slot 0 on a card you are about to program. Empty means factory zeros.
- `NFC_SYSTEM_ID` defaults to `club-box` (1–16 bytes). Changing it changes diversification. Old cards will not match the new system id.
- Replacing `NFC_MASTER_KEY` or `NFC_SDM_META_READ_KEY` does not rewrite cards in the field. Taps fail closed (401 or 503) until the card is personalized again with the new keys. There is no remote rekey command.
- Treat APDU logs from a real card as sensitive. Dry-run output is encrypted command material, not the key, and still does not belong in git.

## Lightning liquidity

**Not yet implemented:** any balance, channel, or fee check in this process. Operators of BTCPay or LNbits use those products' own screens. If invoices fail to be created, the status line on the booking page shows the error from the adapter. A mock backend never needs liquidity.

## Door hardware inspection

Do this with someone qualified. The software check is only: one `pulse-entry` succeeds, and a refused command (lock, fire, egress) does not succeed on the example relay.

Physical checks your installer and AHJ should already have defined:

- Entry strike or lock releases for `DOOR_PULSE_MS` and then secures.
- Magnetic lock, if you have one, drops on request-to-exit and on fire alarm without this server.
- Fail-safe versus fail-secure behaves as designed when you cut power to the lock supply.
- Battery backup, if installed, carries the entry side for the duration the code or insurer required. The app cannot read the battery.
- The door still opens from the inside with this computer unplugged.

Record the date and the person on the [maintenance log](maintenance-log.md). Do not record key material or member data in that log.

## Playtomic token health

Healthy sync: Admin **Sync now** reports a booking count, or the timer stays quiet in the logs. The client caches the token until about a minute before `expires_in` (Playtomic uses 3600 seconds) and refreshes once on HTTP 401.

Unhealthy signs: `playtomic sync failed`, HTTP 429 that keeps failing after backoff (`Playtomic rate limit persisted`), or payments still on 202 (`Playtomic payments snapshot is still processing`). Spacing is `PLAYTOMIC_MIN_GAP_MS` (default 60 seconds). Do not lower it on the live API to "speed up" a failure.

## Maintenance log

Copy [maintenance-log.md](maintenance-log.md) once per month, or print it. Keep completed logs with club records, not in this git repository if they contain staff names you do not want published.
