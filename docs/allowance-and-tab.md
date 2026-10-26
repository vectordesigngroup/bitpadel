# Allowance and tab

A member can buy a drink or a small item without paying at that moment. The club decides the amounts. This app does not ship with prices, fees, or allowance numbers.

Two balances can apply:

- An **allowance** is a credit that comes with a membership plan. An admin sets the amount, in minor units, and how often it starts again: each open visit, each club day, each ISO week, or each calendar month.
- A **tab** is a running total the member pays later.

A charge uses the allowance that is still left in the current period. The rest is added to the tab. Money is stored as integers. Minor units are the club currency's smallest unit (often cents). Sats are stored only when the club set `SATS_PER_MINOR_UNIT` and the sats amount divides into a whole number of minor units. There are no floating-point amounts in the ledger.

Unused allowance from an earlier period is not added to the next period and is not paid out.

**Before a club uses this, a CPA and a Florida attorney should review it.** Stored-value and unused-balance rules, sales tax on counter and vending items, and how to account for sats are legal and tax questions. This page is not legal, tax, or accounting advice.

## Who does what

| Person | What they can do |
|---|---|
| Admin | Set the allowance on a membership type. Set one member's tab limit. Freeze or unfreeze that tab. Post an adjustment with a reason. Read and export the ledger. On the mock payment backend, mark a tab invoice paid. |
| Staff | See who is on site. Look up a balance. Post a charge for a member, including a guest of that member. |
| Member | On `/account`, after the email code, see the allowance left, the amount owed, and recent lines. Press **Settle tab** to pay with Lightning or with a card provider the club turned on. |
| Vending machine | With `VENDING_DEVICE_TOKEN`, identify a member by NFC card or by an LNURL-auth signature, then post one charge. The machine does not open a door and does not move sats during the signature. |

Guest charges are stored on the hosting member. The line keeps the guest id and the guest's display name from the check-in. A closed or deleted guest record cannot be charged.

## Allowance periods

The period key is computed when the charge is posted. It is not a stored balance that rolls forward.

| Period | Key | When it is available |
|---|---|---|
| `visit` | `visit:<check-in id>` | Only while that member has an open check-in newer than `CHECKIN_STALE_MINUTES`. |
| `day` | `day:YYYY-MM-DD` | The civil date in `CLUB_TIMEZONE`. |
| `week` | `week:YYYY-Www` | The ISO week of that civil date. Thursday decides the year. |
| `month` | `month:YYYY-MM` | The civil month in `CLUB_TIMEZONE`. |

Example, not a club price: a plan could be "2 minor units each visit." If the club currency uses 2 decimal digits, the admin page also shows the major-unit string the server computed. The number the club types is the minor-unit amount.

A membership type with no saved allowance, or a booking-only contact, draws the whole charge onto the tab.

## Tab limit and freeze

Each member starts with a tab limit of 0 until an admin sets one. A charge that would make the amount owed larger than the limit is refused. A charge that fits entirely in the remaining allowance does not need tab room.

Freezing refuses any charge that would add to the tab. It does not delete lines and it does not block a charge that the allowance covers completely.

An adjustment is an admin line:

- `credit` reduces what is owed. It cannot be larger than the open tab.
- `debit` adds to the tab, and it still has to fit under the limit. A frozen tab refuses a debit.

The reason is required and is stored on the line with the actor label (`admin-token`, `staff-token`, or the staff account name).

## Ledger

`ledger_entries` is append-only. SQLite triggers abort `UPDATE` and `DELETE`. The visit-retention sweep does not delete these rows. How long to keep them is a decision for the club and its CPA, outside this process.

Each line has a kind:

| Kind | Meaning | Effect on the tab |
|---|---|---|
| `charge` | A counter or vending sale. | `tab_minor` is the part that did not fit in the allowance. `allowance_minor` is the part that did. |
| `settlement` | A tab payment that arrived. | `tab_minor` is negative, equal to the amount paid. |
| `adjustment` | An admin correction. | `tab_minor` is negative for a credit and positive for a debit. |

`request_id` is unique. Sending the same charge again with the same id, source, device, description, unit, amounts, and guest returns the stored line and does not add another. A different body with that id is refused. Staff may omit `requestId`; the server then creates one. Vending machines must send one.

Amounts on a charge are either `unit: "minor"` with `amountMinor`, or `unit: "sats"` with `amountSats`. Do not send both. Sats conversion uses `SATS_PER_MINOR_UNIT` as an exact divisor. Example, not a rate the club should adopt: if the setting is `2`, then `2` sats is `1` minor unit and `3` sats is refused.

## Settlement

`POST /api/player/tab/settle` opens one payment for the open tab minus any payment that is already waiting. The body may include `amountMinor` for a smaller payment. `method` is `lightning`, or `stripe` or `square` when that name is in `CARD_PROVIDERS`.

Lightning uses the existing `PAYMENT_BACKEND` (`mock`, `btcpay`, or `lnbits`). Card checkout uses the existing Stripe or Square adapter. Providers stay pluggable: a new card name is added the same way as for court bookings, in the card set, and then listed in `CARD_PROVIDERS`.

The invoice lifetime follows `HOLD_MINUTES`. When that time passes, the settlement row is marked expired and the amount can be invoiced again. If a Lightning or card notice for that invoice still arrives, the tab is reduced. The debt was not given to someone else, unlike an expired court hold.

Court holds are applied first. An invoice that is not a hold is tried as a tab payment. A second notice for the same settlement does not write a second ledger line.

On `PAYMENT_BACKEND=mock`, the invoice string starts with `mock-not-payable:` and cannot be paid by a wallet. An admin marks it paid with `POST /api/admin/tab-settlements/:id/simulate-payment`.

## HTTP API

Admin routes need the admin token or an owner/manager session. Staff routes need the staff token, the admin token, or a desk session. Player routes need the `player_session` cookie. Device routes need `Authorization: Bearer <VENDING_DEVICE_TOKEN>`. If that variable is empty, device routes return 503.

| Method and path | Body | Result |
|---|---|---|
| `GET /api/admin/allowances` | | Saved plan allowances. |
| `POST /api/admin/allowances` | `membershipType`, `amountMinor`, `period` | Saves that plan. `amountMinor` may be 0. |
| `GET /api/admin/members/:id/tab` | | Balance, pending payments, and the last lines. |
| `POST /api/admin/members/:id/tab` | `limitMinor` | Sets the tab limit. `0` is allowed. |
| `POST /api/admin/members/:id/tab/freeze` | | Freezes the tab. |
| `POST /api/admin/members/:id/tab/unfreeze` | | Clears the freeze. |
| `POST /api/admin/members/:id/tab/adjust` | `direction` (`credit` or `debit`), `amountMinor`, `reason`, optional `requestId` | Posts an adjustment. |
| `GET /api/admin/ledger?memberId=&limit=` | | Newest lines. `limit` is 1–500. |
| `GET /api/admin/ledger.csv?memberId=` | | CSV, oldest first, up to 10,000 lines. |
| `GET /api/staff/members/:id/tab` | | Same balance view. |
| `POST /api/staff/tabs/charges` | `memberId`, `description`, `amountMinor` or `unit` plus `amountSats`, optional `guestId`, `requestId`, `currency` | Posts a counter charge. |
| `GET /api/player/tab` | | The logged-in member's balance. |
| `POST /api/player/tab/settle` | optional `method`, optional `amountMinor` | Starts a payment. |
| `GET /api/player/tab/settlements/:id` | | That member's settlement. A Lightning lookup runs when the backend supports it. |
| `POST /api/devices/vending/challenges` | `deviceId` | Mints an LNURL-auth challenge and a QR path. |
| `GET /api/devices/vending/challenges/:k1` | | `pending`, `verified`, `consumed`, or `expired`. |
| `GET /api/devices/vending/challenges/:k1/qr.png` | | PNG of the LNURL. |
| `GET /api/devices/vending/lnurl?k1=` | | LUD-04 login document. Public, so a wallet can read it. |
| `GET /api/devices/vending/callback?k1=&sig=&key=` | | Wallet signature. Public. Does not pulse a door and does not move sats. |
| `POST /api/devices/vending/charges` | `deviceId`, `requestId`, `description`, amount fields, optional `guestId`, `identity` | Posts the charge. |

`identity.kind` is one of:

- `nfc-sun` with `piccData` and `cmac`
- `nfc-desfire` with `uid`, `counter`, and `cmac`
- `nfc-uid` with `uid`, and only when `NFC_UID_MODE=insecure-dev`
- `lnurl` with the verified `k1`

`deviceId` is 1–41 characters: a letter or number, then letters, numbers, `_`, or `-`. `requestId` is 1–80 characters from letters, numbers, and `. _ : -`.

`currency`, when sent, must match the club currency. The server does not convert between currencies.

## Screens

- `/admin` — **Plan allowance**, **Ledger**, and **Show tab** on a member card.
- `/desk` — **Charge a member** and **Look up balance**. **Charge this member** fills the member id from someone on site.
- `/account` — **Allowance and tab**, recent lines, and **Settle tab**.

## What is left for later

- A controller for a locked cooler or an MDB vending machine. The HTTP API above is what that controller would call.
- Tax reports. The ledger CSV is the export an accountant can start from. It is not a tax filing.
- Paying out unused allowance. This app does not do that.
- A rule for how long to keep ledger rows. They are kept until a process outside this app removes the database file.
