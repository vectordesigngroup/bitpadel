# Security and incident response

How to hold the secrets this app uses, and what to do when one is lost or a door or database is in trouble. This is an operator playbook for the reference app. It is not a legal memo. For a breach, call your attorney before you send any notice. Florida clubs should ask that attorney about Florida Statutes section 501.171. This kit does not interpret that statute.

Egress must always be free. A stuck exit is a life-safety problem for the fire marshal and the AHJ, not a setting in this software. The process reports `controlsEgress: false` and `controlsLifeSafety: false` and will not grow a command that locks or holds a door.

## Key custody

| Secret | Where it lives | Who should hold it |
|---|---|---|
| `ADMIN_TOKEN` | `.env` only | The smallest set of managers. Anyone with it can export bookings, change prices, revoke members, and download marketing contacts. It remains a bootstrap path beside named accounts. |
| Staff passwords | SQLite, scrypt hash only | The person. The plaintext is never stored. Session tokens are stored as SHA-256 hashes. |
| `STAFF_TOKEN` | `.env` only | Front desk, if you still share one token. It cannot change prices or export marketing. If it is unset, the desk accepts a front-desk or coach login, or the admin token. |
| `DOOR_HTTP_TOKEN` | `.env` and the relay | Whoever can log into the relay host. The relay must not be on the public internet. |
| `BTCPAY_API_KEY`, `BTCPAY_WEBHOOK_SECRET` | `.env` and BTCPay | Whoever administers BTCPay. |
| `LNBITS_INVOICE_KEY`, `LNBITS_WEBHOOK_SECRET` | `.env`. The webhook secret is also inside the webhook path. | Whoever administers LNbits. |
| `PLAYTOMIC_CLIENT_SECRET` | `.env` | Whoever can open Playtomic Developer Tools. Regenerating it there invalidates the old one. |
| `NFC_MASTER_KEY`, `NFC_SDM_META_READ_KEY`, `NFC_KEYS_FILE` | Server environment and an offline copy | A manager. The meta-read key is club-wide. A leak lets someone decrypt captured UID and counter values. Forging a tap still needs the per-card file-read key. A lost master key means new cards cannot be diversified to match cards you already issued. |
| `NFC_TRANSPORT_KEY` | Environment while programming | Programmer. Empty means factory zeros. |
| Linking public keys | SQLite | Not secret. They are not spending keys. |
| Privacy tokens | SQLite, on the guest or marketing row | The person they belong to. The guest page does not display them. |

**Not yet implemented:** hardware-token login, a vault integration, and encryption of the SQLite file. Named staff accounts are in [integrations](10-integrations.md).

Rules:

- Generate tokens with a local command such as `openssl rand -hex 24`.
- Do not commit `.env`, `nfc-keys.json`, or `*-nfc-keys.json`. Those names are gitignored. `CONTRIBUTING.md` forbids NFC keys, Playtomic secrets, and door tokens in commits.
- Do not put secrets in the maintenance log, screenshots, or the access log notes.
- The admin page stores the admin token in `sessionStorage`. A shared desk browser keeps it until the tab is closed. Use a staff token on front-desk browsers when you can.
- One process, one database file. A second copy of the app on the same file is an integrity problem, not a failover feature.

## Staff access

1. Give front desk a `front-desk` account, or `STAFF_TOKEN`, and the pages `/desk`, `/kiosk`, and `/`.
2. Give managers an `owner` or `manager` account, or `ADMIN_TOKEN`, and `/admin`.
3. Give coaches a `coach` account if they should see the desk. That role cannot open Admin.
4. When someone leaves the staff, disable their account. That deletes their sessions. If they also knew a shared token, rotate that token.
5. Revoke a member's wallet key or card when they leave the membership. Revoking the member blocks every credential. Restoring the member does not restore revoked keys.

## Playbook: lost admin token

1. Treat every copy of the old token as public.
2. Generate a new `ADMIN_TOKEN`. Put it in `.env`. Restart the app.
3. If the desk used the admin token, paste the new one there, or start using `STAFF_TOKEN` so the desk does not need it.
4. Close admin tabs on shared computers.
5. Skim the access log and recent bookings for changes you did not make. The log does not record which person used the token.
6. If `.env` itself leaked, rotate the door token, webhook secrets, Playtomic secret, and NFC keys as well. NFC key rotation means reprogramming cards. See the [maintenance manual](04-maintenance.md).

## Playbook: compromised Lightning node or processor

This app does not hold channel keys.

1. Stop taking new holds if invoices might be redirected. Set the site so players are told to wait. **Not yet implemented:** a maintenance banner. You can stop the process.
2. In BTCPay or LNbits, follow that product's own incident steps (revoke API keys, invoice keys, and webhooks).
3. Replace `BTCPAY_API_KEY`, `BTCPAY_WEBHOOK_SECRET`, and the LNbits invoice key and webhook secret. Restart this app so new invoices use the new values.
4. Confirm a small test invoice settles and an old webhook secret is rejected.
5. **Not yet implemented:** freezing a channel, sweeping funds, or listing invoices from this app. Use the node operator's tools.
6. Refunds, if you owe any, are done in those tools. This app does not send sats back.

## Playbook: data breach

Personal data the database can hold is listed in [`templates/privacy-notice.md`](../../templates/privacy-notice.md): profile fields, photos, card UIDs, linking keys, access log, check-ins, guest contacts, and marketing rows. Playtomic player emails are included when sync is on.

1. Take the app off the public network. Keep egress hardware working. Stopping this process must not lock people in.
2. Preserve a copy of the database and the JSON logs for the attorney and for your own timeline. Do not email the database around.
3. Rotate every secret in the custody table.
4. Ask counsel what notice is required. If you operate in Florida, ask specifically about F.S. 501.171. This repository has no notice letter and will not send one. **Not yet implemented:** breach notification.
5. For a person who asks about their guest contact, use `/privacy` if they have the token. Deletion clears that contact. It does not erase the member, the photo, or the access log. Say that plainly.
6. If player emails appeared on a public page, that is in scope even if the API was only misconfigured. The public calendar is supposed to show "Imported booking" only.

## Playbook: door stuck locked

Decide which side is stuck.

**People cannot leave.** This is an emergency. Use the panic hardware, request-to-exit, and fire-alarm release. Those circuits are outside this app. If they fail, call the fire marshal and the installer. Do not spend time restarting Node. See the [emergency manual](08-emergency.md).

**People cannot enter, and the exit still works.**

1. Use the fob, PIN, or a staff escort.
2. Read the kiosk. `door-failed` means the relay did not accept `pulse-entry`.
3. A fail-secure lock stays locked when its power is off. A fail-safe lock unlocks when its power is off. Which one you have is the installer's code decision. This app does not switch modes and does not have a "unlock until further notice" command.
4. Restarting the app does not queue missed pulses.
5. If the strike is mechanically jammed, call the locksmith. The example relay does not drive GPIO.

## Playbook: lost NFC master key

1. You cannot derive the same per-card keys without the master key, the meta-read key, and `NFC_SYSTEM_ID`.
2. If the offline backup is good, restore it to the server and restart.
3. If both copies are gone, generate new keys, accept that issued cards will fail closed, and reprogram cards from factory or from a known transport key.
4. Mark the old UIDs lost if those cards are unaccounted for, so a later enroll of a found card is a conscious choice.

## After any incident

Write the date, what you rotated, and what is still open on the [maintenance log](maintenance-log.md). Leave the secret values off the page.
