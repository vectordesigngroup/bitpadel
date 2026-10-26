# Operating manual

Front desk and daily operations for the reference app. Manager-only setup is in the [admin manual](02-admin.md). One-page versions are in [quick cards](README.md#one-page-cards).

This is not a fire or lock procedure. People leave without this app. If an exit is blocked, follow the [emergency manual](08-emergency.md) and call the installer and the fire marshal. Do not wait for the kiosk.

## Before you start

You can sign in with a staff username and password, or with the staff token or the admin token. The desk accepts a front-desk account, a coach account, the staff token, or the admin token. Admin pages accept an owner, a manager, or the admin token. Passwords are stored as scrypt hashes. Session tokens are random and only their hash is stored. The legacy tokens stay in `.env` as a bootstrap path. See [integrations](10-integrations.md).

Know which payment mode the club is in. `GET /api/health` includes `paymentBackend`:

- `mock` is for practice. The invoice text starts with `mock-not-payable:` and cannot be paid.
- `btcpay` or `lnbits` produces a real Lightning invoice. The booking page says the invoice is payable.

Guest count stays at zero until a manager sets `GUEST_LIMIT` to a number above zero, or sets a cap on that member in Admin. The kiosk still shows **More**. Pressing it past the cap shows "That is over the guest limit."

## Opening checklist

1. Open the kiosk page (`/kiosk`). You should see the two safety lines: the service only pulses entry, and leaving does not use the screen. If the page says the access server is unreachable, the app is down. Use the fob, PIN, or staff path, and tell a manager. Those fallbacks are physical. **Not yet implemented:** fob or PIN logic inside this app.
2. Choose the area the kiosk should open (the ids in `ACCESS_AREAS`, often `lounge` or `after-hours`). A QR appears with the line "Scan with an enrolled Lightning wallet." The QR changes by itself. Default lifetime is `K1_TTL_SECONDS` (90 seconds).
3. Open the desk (`/desk`). Paste the staff or admin token and choose **Load desk**. The headcount line is who is still checked in. Visits older than `CHECKIN_STALE_MINUTES` (default 480, which is 8 hours) are checked out by the server about every 15 seconds. Glance at the list anyway. Someone who is still in the building should remain until they leave.
4. Open booking (`/`). Courts and open slots for the day should be listed. A slot covered by Playtomic says "Imported booking covers this time" and has no hold button.
5. On the desk, read **Today's imported bookings** and **Conflicts**. A conflict means a Playtomic court is not mapped, or an import overlaps a Lightning booking or a pending hold. You cannot clear a conflict from this screen. **Not yet implemented:** a resolve button. A manager uses the admin API described in the [admin manual](02-admin.md).
6. Walk the exit. Leaving must work with no phone, no card, and no server. Confirm the fob, PIN, or staff entry path the installer left. The app cannot test that hardware.
7. If the kiosk shows "UID-only cards are clonable", the club is in `NFC_UID_MODE=insecure-dev`. Tell a manager. That mode is for development. Copied cards can open the door.

## Member check-in with a Lightning wallet

LNURL-auth proves the wallet is the one enrolled for that member. It does not pay and it does not show a balance.

1. The member scans the kiosk QR with the same wallet they enrolled.
2. On success the screen says "Entry pulsed. The strike releases on its own. You can always leave without this screen."
3. The check-in panel shows the display name, the photo if one was stored, and the guest count.
4. The desk lists them with membership type, credential type `lnurl`, and guest count.

If the screen refuses the scan, read the line and use the matching row in the [troubleshooting guide](05-troubleshooting.md). Common lines:

| Screen | Meaning |
|---|---|
| This wallet is not enrolled. | No active linking key for that wallet. |
| Membership is not active. | A manager revoked the member. |
| That area is closed right now. | Outside `ACCESS_AREA_HOURS` for that area. |
| That code expired. | The QR rotated. Scan the new one. |
| That code or card counter was already used. | The same challenge was scanned twice. |
| Entry controller did not respond. | The pulse did not reach the relay. See the [door-fault card](quick-cards/door-fault.md). |

A member who has never enrolled needs a manager to add them and open **Enrollment QR**, then **Open enrollment page**. The member scans that QR once. The page then says "Wallet enrolled."

## Member check-in with an NFC card

The preferred card is an NTAG 424 DNA programmed with the club keys. A phone that opens the card's link, or `npm run reader:bridge` on the kiosk computer, sends the tap to the server. The kiosk QR is for wallets. The card does not need that QR.

1. The member presents the card to the phone or the reader.
2. A good tap pulses entry and creates the same check-in panel as a wallet. Credential type on the desk is the card scheme (`ntag424-sun` or `desfire`).
3. A second tap of the same counter is refused. The screen says the code or card counter was already used.

DESFire EV2 or EV3 can be a credential if a reader completes the card session and posts the proof. The server checks that proof. **Not yet implemented:** programming a DESFire card. `npm run card:desfire` exits with that message. `npm run card:program` personalizes NTAG 424 DNA. The reader bridge only reads an NDEF web address.

A plain UID card is refused unless a manager turned on insecure UID mode. Leave that off.

A Bolt Card is a Lightning payment card. It is not a door card. Do not pay with a door card or open the door with a payment card.

## Guest count and named guests

1. After a successful unlock, the member (or you, on the kiosk) presses **More** once per guest who came in with them, up to the cap.
2. **Fewer** lowers the count. It will not go below the number of named guests already saved. Remove those names first. **Not yet implemented:** a delete-guest button on the kiosk or desk. Deletion is the privacy flow or the admin API.
3. Press **Name a guest**. The form asks for a name, email or phone, and a waiver acknowledgement. The waiver box starts unchecked and is required.
4. The marketing box starts unchecked. Leave it unchecked unless the guest asks to hear from the club. Marketing messages go only to contacts with an active opt-in. The privacy link is transactional and does not require that box.
5. Submit. The page says "Guest added. A privacy link was created for this contact." The server stores a privacy token and, when email or SMS is a real provider, sends the `/privacy` link to the contact on the form. That send is transactional and does not require the marketing box. The page still does not show the token. With the default `console` providers, nothing is delivered; the log line redacts the address. Opted-in contacts are the marketing CSV.
6. The desk guest count is the number on the check-in, not a second person per name. Raise the count before you add the name. If you skip that, the form says "Raise the guest count before adding another name."

A guest email that matches today's Playtomic booking is linked to that booking. The public calendar still does not show the email.

## Family memberships

Default membership type ids are `standard` and `household` (`MEMBERSHIP_TYPES`). The desk prints the type next to the name.

A household is a label plus a primary member and optional dependents. It does not set a price, a guest cap, or who may unlock. Each person still needs their own wallet or card. In Admin, **Make household primary** creates the household, and **Add dependent** attaches another member id. If the primary has an email, the app sends a transactional household notice. **Not yet implemented:** family billing, and a rule that a dependent unlocks because the primary is present.

## Desk view

`/desk` after **Load desk**:

- Headcount: members on site, guest count, and the sum.
- Each person: display name (or the membership label if no name was saved), membership type, how they entered, guest count, photo if one exists, and **Check out**.
- Today's Playtomic bookings: court and player name or email. This list is for staff. The public booking page says "Imported booking" and leaves names and emails off.
- Conflicts: short text such as an unmapped court or an overlap.

**Check out** when the member leaves. Do not use checkout to lock the door. Checkout only ends the visit row.

## Counter charges

On `/desk`, **Charge a member** posts a drink or a small item.

1. Paste the member id, or press **Charge this member** on someone who is on site.
2. If the item is for a guest, paste that guest id from the check-in. The charge stays on the hosting member and the ledger keeps the guest's name.
3. Type what was sold and the amount in minor units. The club sets that amount. This manual does not.
4. Press **Post charge**. The screen shows how much came from the allowance and how much went on the tab.
5. **Look up balance** before you sell if you want to see what is left.

Use a request id when the same tap might be sent twice. Sending that id again with the same charge does not add a second line. A different amount with the same id is refused.

If the tab is frozen, or the sale would pass the member's tab limit, the charge is refused. Ask a manager. You cannot change the limit, freeze the tab, or edit a posted line from the desk.

## Court time paid with Lightning

1. On `/`, pick the court if you use the court buttons.
2. Press **Hold and get invoice** on an open slot that is not covered by an import.
3. The page shows the amount in the club currency and a Lightning invoice. The player scans it with a Lightning wallet.
4. Wait until the page says "Booked. Payment settled." A screenshot of a wallet is not settlement.
5. The slot then shows as booked. Another person cannot hold it.

Prices are whatever a manager typed for that slot, in minor units (the smallest unit of `CURRENCY`, often cents). This manual has no prices. The blank model is [`templates/financial-model.csv`](../../templates/financial-model.csv). Every input there starts at zero.

Holds expire after `HOLD_MINUTES` (default 15). The page then says the hold expired and the slot was released. A payment notice that arrives after that does not create the booking.

If the slot says "Imported booking covers this time", do not try to sell that hour on Lightning. Playtomic already has it. The hold API returns "That time is already on the imported calendar."

An optional receipt email on the booking page is sent after settlement when email is not `console`. **Not yet implemented:** a Lightning address or LNURL-pay link, and a shop or lesson product on this page. Shop ideas stay in [Lightning integrations](../04-lightning-integrations.md).

## Reading Playtomic bookings

Playtomic sync is optional and read-only. If `playtomicConfigured` is false on `/api/health`, skip this section.

- Public booking page: a heading **Imported bookings**, court, time, and the label "Imported booking".
- Desk: today's imported players, for matching an arrival.
- A wallet or card check-in can attach today's Playtomic booking when the member's Playtomic player id matches, or when the member email matches a player email.
- A named guest email can match the same way.

You cannot change the Playtomic booking here. Two-way sync is the Playtomic Connect partner program, which this app does not call. Do not scrape Playtomic.

Canceled imports stop blocking the slot after the next successful sync.

## Failed payments

1. Tell the player the hold lasts `HOLD_MINUTES`. If they walk away, the slot opens again by itself.
2. On BTCPay, an expired or invalid invoice releases the hold. Other webhook events are ignored.
3. On LNbits, a notice that is still pending does not confirm the booking.
4. If they pay after the hold expired, the app does not book the slot and does not send the money back by itself. **Not yet implemented:** an automatic refund on expiry. A manager can request a refund for a booking that did settle: Admin **Refund** on that booking. Mock records it. BTCPay calls the store refund endpoint. LNbits pays a customer BOLT11 when you paste one, and otherwise returns "Not supported by this backend" without pretending the sats moved. Stripe and Square refund the card payment after their webhook has stored the provider payment id. Follow the club's written refund rule.
5. The booking page lists Lightning and any card provider in `CARD_PROVIDERS`. The player picks one. A card hold shows the provider's checkout link instead of a Lightning invoice. **My bookings** (`/account`) emails a one-time code. That code is transactional, not marketing. Inside `CANCEL_WINDOW_HOURS` the player can cancel. `CANCEL_REFUND=full` asks the provider to refund first and keeps the booking if the provider refuses. `0` turns self-cancel off. Reminder checkboxes are a separate opt-in from marketing.
5. On a mock server, a manager uses **Simulate payment** in Admin. That button is absent when the backend is BTCPay or LNbits.
6. A second settlement notice for the same invoice does not create a second booking.

## Lost or stolen card

Use the [lost-card card](quick-cards/lost-card.md) at the desk, then:

1. A manager opens Admin, finds the member, and presses **Mark lost** or **Revoke card** on the active card line (`scheme`, UID, status).
2. That card stops unlocking. The kiosk says "That card is not active."
3. Program a new NTAG 424 DNA (see [card programming](../nfc-card-programming.md)) and enroll the new UID. The admin **Enroll card** button sends scheme `ntag424-sun`.
4. If the same physical card is recovered and you trust it, enrolling that UID again reactivates it and resets the stored counter. If it was stolen, do not enroll that UID again. Mark it lost and issue a different card.
5. Lost phone: **Revoke key** on that wallet's public key. The member scans a new **Enrollment QR**. Revoked keys stay revoked. **Restore member** turns the membership back on. It does not turn a revoked key back on.

## Door fault during a shift

1. Read the kiosk line. "Entry controller did not respond" means the pulse failed. The app does not try again later.
2. Let the member in with the fob, PIN, or a staff escort.
3. Do not block the exit while you troubleshoot. This software cannot lock a door.
4. Tell a manager. They check the relay, `DOOR_BACKEND`, and the matching URL, token, GPIO pin, or serial path. Details are in the [troubleshooting guide](05-troubleshooting.md), the [door-fault card](quick-cards/door-fault.md), and [integrations](10-integrations.md).

## End of day

There is no close-out button.

1. **Check out** anyone who has left. Anyone still inside can stay on the list.
2. Skim Admin **Access log** for `door-failed` and denied attempts. Rows older than `LOG_RETENTION_DAYS` (default 90) are deleted.
3. In Admin, open **Download CSV** if the bookkeeper wants the latest 500 settled bookings. For a date range that also includes stored Playtomic payment rows, use **Download sales CSV**. Playtomic rows are ids, status, total text, dates, and product SKU. They omit payer names and tax ids. **End of day** totals Lightning, Stripe, Square, and refunds for one date. **Email summary** sends that text when an owner address is set.
4. Read desk conflicts once more and leave them for a manager if any are open.
5. Unpaid holds expire on their own. You do not cancel them one by one unless the slot should not be sold. **Cancel slot** on an open slot removes that offering.

**Not yet implemented:** a tax worksheet. The end-of-day screen is the payment-method total, not a filing.
