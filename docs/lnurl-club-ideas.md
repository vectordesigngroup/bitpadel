# Member vending and other LNURL ideas: design notes

Status: **proposals, not built.** Nothing on this page exists in `reference/club-box` yet. The list and its order live in the [roadmap](ROADMAP.md). These notes say how each idea could reuse what club-box already has, so a contributor can pick one up.

## What club-box already gives you

- **Identity without payment.** LNURL-auth: the wallet signs a one-time challenge with a key made only for this club. No sats move. The server checks the signature, expiry and replay, then looks up the member. NTAG 424 DNA cards (one-time SUN URL) are the fallback for members whose wallet does not support LNURL-auth, and a staff path stays available.
- **Areas and pulses.** Doors are addressed by `area`. The door drivers (`http`, `gpio`, `serial`) send an entry-only `pulse-entry` with an area, a pulse length and a request id. Every grant or denial lands in the access audit log.
- **Booking-aware rules.** `BOOKING_ENTRY` already decides whether a confirmed booking opens an area in a before/after window.
- **Guests tied to a host.** Guest check-ins already carry `host_member_id`, with a guest cap and a waiver.
- **Payments.** Lightning invoices (BTCPay, LNbits or mock) and optional Stripe and Square card checkout, plus refunds and end-of-day totals.

## Shared building block: allowance and tab ledger (new)

Several ideas below need the same missing piece: a small per-member ledger.

- **Allowance:** a counter per member, per item class, per period (for example "2 waters per visit" or "per day"). Each grant writes a row; the count is derived, never edited.
- **Tab:** items that are not covered by the allowance post a line to the member's tab. The member settles it with a Lightning invoice or card checkout through the existing payment backends, or staff settle it at the desk.
- **Guest lines:** a guest's items post to the host member's tab or allowance, using the existing `host_member_id`.
- **Rules:** limits per visit and per day, a tab ceiling that blocks new grants until the tab is paid, and staff-only overrides recorded in the staff audit log.
- **Audit:** every grant, vend, failure and refund is append-only, like the access audit.

## Next

### Member vending
- **Flow:** the member scans the QR on the machine or cooler (LNURL-auth) or taps their NFC card at a reader on it. The server identifies the member, checks the allowance and tab rules, then authorizes one vend. A guest's drink is charged to the host.
- **Hardware paths:**
  1. **Locked glass-door cooler.** The simplest path: an electric lock on the cooler door, driven like a door (`area = "cooler-1"`). One grant opens the door once. It cannot count items, so it suits a "take your allowance" honor model with a camera and stock counts.
  2. **Spiral vending machine with MDB.** Exact per-item vending. A small computer with an MDB adapter acts as the machine's *cashless device* (MDB address 0x10). After a grant it opens a session with credit equal to the allowance or tab limit; the machine reports the selection and price; the vend result (success or failure) posts to the ledger. A failed vend posts nothing.
  3. **Commercial smart coolers** usually ship with a closed payment platform. Only use one if its vendor offers an open unlock API.
- **Software needed:** the ledger above, a vending area type, and an MDB cashless driver (separate process, like the reader bridge) for path 2. Existing open-source MDB cashless code can be studied before writing one.
- **Safety:** the cooler lock is not a life-safety door, but keep a keyed override for restocking and power loss.

### Lockers
- **Flow:** scan or tap at the locker bank to claim a free locker for the visit; scan again to open it; release at checkout or at closing time.
- **Design:** each locker is an `area` (for example `locker-12`) on a relay board, using the same pulse drivers. A claim table links one locker to one member for a time window. Staff can force-release and open from `/admin`, with an audit entry.
- **Hardware:** a 12 V lock per door on a multi-channel relay board, a keyed override on every locker, and a separate power supply.

### Booking-gated equipment (ball machine, court lights, gear rental cabinet)
- **Flow:** equipment unlocks only while the member's booking for that court is active, reusing the `bookingCovers` window logic.
- **Lights:** a relay drives the lighting contactor for the court during the booking plus a grace period. Contactors and mains wiring are for a licensed electrician. Staff can always override lights on, and emergency lighting never depends on this software.
- **Ball machine and gear cabinet:** stored in a locked cabinet; a grant opens the cabinet, and return is checked by staff or a door sensor.
- **Software needed:** an area-to-court map, an "equipment" area type with on/off (not only pulse), auto-off at the end of the window, and a staff override.

### Member-vouched guest passes
- **Flow:** the member signs (LNURL-auth) to vouch for a guest. The server issues a one-day QR or one-time link for that guest, limited to the guest cap and the waiver rules already in check-in.
- **Design:** reuse the `guests` table and `host_member_id`; the pass expires at the end of the day or after one entry. Revoking the host's key also cancels their open passes.

## Later / ideas

### Signed tournament check-in and score confirmation
Players check in by signing at the kiosk. After a match, both sides sign the score; a result counts only when both teams agree. Disputes go to staff. Ratings update from confirmed results only. Builds on [tournaments and leagues](05-tournaments-and-leagues.md).

### Prizes, streak and referral rewards (LNURL-withdraw)
The club issues a one-time LNURL-withdraw link or QR for a prize or reward, with an amount cap and an expiry. LNbits can already create withdraw links. Club-box would add rules (who qualifies, one claim per member) and the audit trail.

### Coach tips (Lightning address / LNURL-pay)
Each coach gets a Lightning address or LNURL-pay QR that pays the coach's own wallet, shown on the class page or the court screen. The club does not hold tip money.

### Gift cards (LNURL-withdraw / Bolt Card)
Printed or NFC gift cards. Either a one-time withdraw link (sats) or a Bolt Card on an NTAG 424 DNA card (the LNbits Bolt Cards extension), or court credit held in the ledger above. Expiry, unclaimed balances and refund rules need local legal advice.

### Member voting
One signature per member per question (event dates, class schedule, café menu). Store one vote per member key; results are counts only.

### Possibly new ideas (not seen at sports clubs yet)
- **Late-cancel and no-show compensation:** when a booking is cancelled late, part of the fee is paid back automatically to the players left short, through a withdraw link each.
- **Pay-per-minute equipment:** court lights or the ball machine run only while a small Lightning payment stream continues, and turn off when it stops.
- **Rewards that grow with play frequency:** the reward per visit steps up with how often a member plays in a period, with no separate app.
- **Kiosk partner-finder board:** a member signs "looking for a 4th at 7 pm" at the kiosk; other members see the post with a rating drawn from confirmed results only.

## Tax and legal note for operators

Free allowances (for example included drinks), tabs, gift cards, prizes and sats rewards can have **sales-tax and income-tax implications** for the club, and gift cards can fall under local gift-card or unclaimed-property rules. Prizes and rewards paid in bitcoin may need records for tax reporting. **Check with a tax advisor before turning any of these on.** This page is not tax or legal advice.
