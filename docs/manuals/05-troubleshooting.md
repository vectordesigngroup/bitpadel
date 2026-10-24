# Troubleshooting guide

Start with the sentence on the screen or the JSON log line. Then use the row below. Paths are on the club-box server unless noted.

## Door

| Symptom | Likely cause | What to do |
|---|---|---|
| Kiosk: "Entry controller did not respond. Use a fob, PIN, or staff." Access log reason `door-failed`. | The HTTP relay did not answer, refused the token, or timed out (`DOOR_HTTP_TIMEOUT_MS`, default 2000). The call is not retried. | Let the person in through the physical fallback. Confirm the relay process is up, `DOOR_HTTP_URL` is reachable on the private network, and `DOOR_HTTP_TOKEN` matches `RELAY_TOKEN`. |
| Kiosk never shows a QR. | No area selected, or `ACCESS_AREAS` is empty or invalid, or the server is down. | Pick an area button. If the page says the server is unreachable, restart the process and check `/api/health`. |
| "That area is closed right now." | `ACCESS_AREA_HOURS` for that id does not include `CLUB_TIMEZONE` now. Hours are checked when the QR is minted and again when the signature arrives. | Wait for the window, or a manager edits the hours and restarts. Empty hours means always allowed. A window past midnight is written with the start later than the end. |
| "This wallet is not enrolled." | The linking key is unknown or revoked. | Enroll from Admin, or the member must use the wallet that was enrolled. |
| "Membership is not active." | Member status is revoked. | **Restore member** if they should enter. That does not un-revoke a key. |
| "That code expired." | `K1_TTL_SECONDS` elapsed (default 90). | Scan the new QR. |
| "That code or card counter was already used." | Replay of the same k1, or the NFC counter is not newer than the stored value. | Scan a fresh QR. For a card, do not reuse a captured URL. A lost card that is enrolled again resets the stored counter. |
| "Too many attempts" or "Too many codes." | `RATE_LIMIT_MAX` (default 30 per `RATE_LIMIT_WINDOW_SECONDS`, default 60) or `CHALLENGE_RATE_LIMIT_MAX` (default 120). | Wait for the window. Do not raise the limit to hide a stuck kiosk that is minting QRs in a loop. |
| Example relay returns 401. | Bearer token mismatch. | Set both sides to the same long random token and restart both. |
| Example relay returns 404. | Path is not `POST /pulse`. | Point `DOOR_HTTP_URL` at `http://<relay>:8787/pulse`. |
| Someone asks you to lock the door from the app. | The app and the example relay refuse lock, hold, egress, and fire commands. | Leave egress on its own hardware. Call the installer if the physical door is stuck. |
| Exit does not open. | Life safety, not an app setting. | Follow the [emergency manual](08-emergency.md). Do not look for a software release command. There is not one. |

## NFC

| Symptom | Likely cause | What to do |
|---|---|---|
| "This card is not enrolled." | UID is not an active credential. | Enroll it in Admin, or program with `--member`. |
| "That card is not active." | Status is `revoked` or `lost`. | Issue a new card. Re-enroll the same UID only if you trust that card. |
| 503 "Card verification is not configured." | Master key or meta-read key missing. | Set both keys or `NFC_KEYS_FILE` and restart. |
| 401 "Card authentication failed." | Server keys differ from the keys written to the card, or the URL placeholders were edited by hand. | Program again with the same keys the server uses. |
| 403 on a UID-only tap. | `NFC_UID_MODE` is `off`. | Leave it off. `insecure-dev` accepts clonable UIDs and the kiosk shows a warning. |
| `npm run card:program` says the transport key does not match. | Slot 0 is not the factory zeros and `NFC_TRANSPORT_KEY` is empty or wrong. | Set `NFC_TRANSPORT_KEY` to the current slot 0 key. |
| URL too long. | NDEF payload must be 255 bytes or less. | Shorten `PUBLIC_BASE_URL` or the area id. |
| `pcsclite` fails to load. | The programmer machine lacks `pcscd` or the optional native module. | Install them there. The server image does not include them. |
| Bridge: card did not select the NDEF application. | The card is not an NDEF-programmed NTAG 424, or the reader cannot see it. | Program the card. DESFire sessions are **not yet implemented** in the bridge. |
| Dry-run prints APDUs and enrolls nothing. | `--dry-run` uses an in-memory card. | That is expected. Drop the flag on a real reader when you mean to write. |

## Lightning payments

| Symptom | Likely cause | What to do |
|---|---|---|
| Invoice text starts with `mock-not-payable:`. | `PAYMENT_BACKEND=mock`. | Expected in practice mode. A manager uses **Simulate payment**. Switch backend only when BTCPay or LNbits is configured. |
| "Booked. Payment settled." never appears. | Webhook did not arrive, signature failed, LNbits still `pending`, or the invoice is unpaid. | Confirm `PUBLIC_BASE_URL` is reachable from BTCPay or LNbits. Match webhook secrets. On LNbits the path includes `LNBITS_WEBHOOK_SECRET`. |
| Hold expired and the player says they paid. | Settlement after `HOLD_MINUTES`, or a payment the webhook marked expired. | The slot is not booked. **Not yet implemented:** an automatic refund. Use the processor's tools and the club's written refund rule. |
| "That slot is not open" or a second person cannot pay. | Slot is held, booked, or canceled. | Wait for expiry or pick another time. Concurrent holds are rejected on purpose. |
| "That slot has already started." | Start time is in the past. | Create a later slot. |
| "That time is already on the imported calendar." | An active mapped Playtomic booking overlaps the slot. | Do not sell it on Lightning. |
| "That court already has a slot in that window." | Generate or add overlapped an existing slot. | Pick a free window. |
| Price on the invoice does not match what you wanted. | The slot's minor units, or `SATS_PER_MINOR_UNIT` for LNbits. | **Update price** only while the slot is open. LNbits does not fetch a market rate. |
| BTCPay invoice has no Lightning QR. | Payment method id does not match the store. | Set `BTCPAY_PAYMENT_METHOD` to the id the server uses (`BTC-LN` or `BTC-LightningNetwork`). |
| Simulate payment is missing. | Backend is not `mock`. | Expected. |
| Same invoice paid twice in the log as `already-confirmed`. | A second webhook for a booking that exists. | Expected. One booking. |

## Playtomic sync

| Symptom | Likely cause | What to do |
|---|---|---|
| Admin says Playtomic is not configured. | Client id, secret, and tenant id are not all set. | Set all three or leave all three empty. Restart. |
| Sync is slow. | `PLAYTOMIC_MIN_GAP_MS` defaults to 60000. Playtomic documents about one call per minute. | Wait. Do not set the gap to 0 against the live API. |
| HTTP 429 and then "Playtomic rate limit persisted". | Backoff used `Retry-After` or doubled from 1 second up to 16 seconds, five attempts, and the limit remained. | Wait and **Sync now** later. Leave the 60 second gap in place. |
| Payments error "snapshot is still processing". | First payments call returned 202. | The client retries on `Retry-After`. If attempts run out, booking sync can still succeed. `paymentError` is returned on the sync report. Try again later. The snapshot can take minutes. |
| 401 after a token that used to work. | Token expired and the refresh was rejected, or the secret was regenerated. | The client refreshes once. If that fails, check the secret in Developer Tools. |
| Imported booking missing on the public page. | Unmapped court, canceled status, or the booking ended. The public list hides blocks that have already ended and looks back 24 hours for ones still in progress. | Map the resource id. Sync again. |
| Conflict "not mapped". | Active booking whose resource id has no row in court map. | Map it in Admin. The conflict clears on a later sync when the court is mapped. |
| Conflict "overlaps". | Import overlaps a Lightning booking or a pending hold. | A manager decides which one stands. Resolving the flag is `POST /api/admin/playtomic/conflicts/<id>/resolve`. **Not yet implemented:** a button. |
| Player email on the public calendar. | That would be a bug. The public label is "Imported booking". | If you see an email on `/`, stop and treat it as a privacy incident. Staff lists on `/desk` are allowed to show the name or email. |
| You need to change the booking in Playtomic from this app. | The client refuses any POST except the token URL. | Change it in Playtomic. Two-way sync is Playtomic Connect. **Not yet implemented** here. |

## Check-in mismatch

| Symptom | Likely cause | What to do |
|---|---|---|
| Desk name is the membership label, not the person's name. | Display name was left empty. | Save a display name in Admin if your notice allows it. |
| Photo missing. | No photo stored, or the file was removed from `PHOTO_DIR`. | Upload through the photo API. **Not yet implemented:** an admin-page upload. |
| Guest form: "Raise the guest count before adding another name." | Named guests cannot exceed the count on the check-in. | Press **More** on the kiosk first. |
| "That guest count is over the member's limit." | `GUEST_LIMIT` is empty (treated as 0) or the member override is lower. | A manager raises the cap and restarts if they changed `.env`. |
| Person is on today's Playtomic list but the check-in did not link. | Email and Playtomic player id both failed to match, or the booking is outside the club-local day (`CLUB_TIMEZONE`). | Save the player id or the same email on the member, or put that email on the guest form. Sync so the booking is present. |
| Someone disappeared from the desk while still in the building. | `CHECKIN_STALE_MINUTES` elapsed (default 8 hours) or someone pressed **Check out**. | They unlock again to start a new visit. **Not yet implemented:** undoing a checkout. |
| Household member cannot enter on the primary's card. | Each person needs their own credential. | Enroll their wallet or card. |

## Server down

| Symptom | Likely cause | What to do |
|---|---|---|
| Kiosk: "Access server unreachable. Use a fob, a PIN, or staff." | Browser cannot load `/api/health` or the challenge API. | Use the physical entry path. Exits stay available. Restart the process. Docker: `docker compose ps` and `docker compose logs`. |
| Booking page cannot hold a slot. | The hold needs the server. | Wait until it is back. There is no offline queue. |
| Wallet cannot complete LNURL-auth. | The phone must reach `PUBLIC_BASE_URL`. | Fix DNS, TLS, or the firewall. Door checks themselves use local SQLite and do not call a wallet host. The phone still has to deliver the signature. |
| Process exits at startup. | Invalid `.env` (missing currency, short token, Playtomic half-set, bad timezone). | The error is printed to stderr. Fix the variable. Partial Playtomic configuration is rejected on purpose. |
| Two bookings for one slot after a crash. | Should not happen. The claim uses an immediate transaction on one SQLite file. | If you ran two processes on one file, stop one. **Not yet implemented:** a multi-server database. |
