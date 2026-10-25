# Admin and manager manual

Tasks that need the admin token. Desk staff procedures are in the [operating manual](01-operating.md).

Nothing here is legal advice. Privacy text in the app is a template. Have a lawyer review what you publish. The [disclaimer](../../DISCLAIMER.md) covers the rest of the kit.

## How admin access works

Open `/admin`. Sign in with a staff username and password, or paste `ADMIN_TOKEN` or a session token. The browser keeps the bearer token in `sessionStorage` for that tab. A password login also sets an `HttpOnly` `club_session` cookie. Closing the tab drops `sessionStorage`. Sessions expire after `SESSION_TTL_HOURS` (default 12).

`STAFF_TOKEN` is optional. If it is set (at least 16 characters), the desk, the on-site list, checkout, staff photos, today's Playtomic list, and the conflict list accept the staff token, a front-desk or coach account, or the admin token. Marketing export, member edits, court prices, card issue, refunds, and Playtomic sync accept an owner, a manager, or the admin token.

Roles are `owner`, `manager`, `front-desk`, and `coach`. Owners can create other owners. Managers can create managers, front desk, and coaches, and cannot create owners. Front desk and coach can use the desk and cannot open Admin. Disable an account from the API `POST /api/admin/staff/<id>/disable` or by asking an owner. Disabling deletes that account's sessions. The shared tokens are still rotated in the [security manual](06-security-incident.md).

Admin **Staff audit** lists non-GET calls under `/api/admin`: time, actor, method, path, and status. The shared admin token is recorded as `admin-token`. A named account is recorded as the display name and username. The list and the CSV are owner, manager, or admin-token only. The row does not store the token or the request body. **Not yet implemented:** a hardware-token second factor.

## Member profiles

1. **Add a member.** The label is a membership number or similar handle. The new member is active.
2. Fill **Display name**, **Email**, **Phone**, **Playtomic player id**, **Membership type**, and **Guest cap**. Press **Save profile**. Empty text clears that field. A blank guest cap clears the per-member override and the club `GUEST_LIMIT` applies. Allowed type ids are `MEMBERSHIP_TYPES` (default `standard,household`).
3. **Revoke member** blocks wallet and card entry. **Restore member** makes the membership active again. Restored members still need a key or card that was not revoked.
4. **Enrollment QR** then **Open enrollment page** is the one-time wallet enroll. The linking key is a public key for this site. It is not a balance and not a payment key.

The same fields are accepted by `POST /api/admin/members/<id>/profile`. Example shape, with your own values:

```json
{
  "displayName": "Member name",
  "membershipType": "household",
  "guestLimit": 1
}
```

Choose a JPEG, PNG, or WebP and press **Upload photo**. The file must be at most `PHOTO_MAX_BYTES` (default 1 MB) and must fit the 2 MB HTTP body. Files go through the storage adapter (`STORAGE_BACKEND=local` by default) into `PHOTO_DIR`, or a `photos` directory next to the SQLite file. The kiosk shows the photo after a successful unlock, using that visit's token. The desk loads it with the staff or admin token. The public booking page does not get the file.

**Not yet implemented:** automatic deletion of the photo file when a visit is purged.

## Family plans

"Family" in this app is a household record, not a priced plan.

1. On the member card, press **Make household primary**. That calls `POST /api/admin/households` with the member id.
2. On the primary's card, paste another member id and press **Add dependent**.

Each person unlocks only with their own enrolled wallet or card. The household does not bill anyone and does not raise the guest cap. If the primary has an email, a transactional notice is sent.

**Not yet implemented:** invoices for a family plan, and shared entry.

## Reports and data you can actually pull

| What | Where | Who |
|---|---|---|
| Server snapshot | Admin **Server**, or `GET /api/health` | Health is public. It has backends, areas, guest cap, and whether NFC and Playtomic are configured. It has no member data. |
| Lightning bookings | Admin list, and **Download CSV** (`GET /api/admin/bookings.csv`) | Admin. Latest 500 settled rows. Columns include minor units, currency, sats if stored, payment reference, confirmed time. |
| Sales, date filtered | Admin **Download sales CSV** (`GET /api/admin/reports/sales.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`) | Admin. Lightning bookings in range plus stored Playtomic payment rows (id, status, total text, date, product SKU). No payer names or tax ids. |
| Access attempts | Admin **Access log** (`GET /api/admin/audit`) | Admin. Time, result, reason, area. |
| Who is on site | `/desk` | Staff or admin. |
| Today's Playtomic bookings and conflicts | `/desk` and Admin **Playtomic courts** | Staff or admin for the lists. Sync and mapping are admin. |
| End of day | Admin **End of day** (`GET /api/admin/reports/daily?date=YYYY-MM-DD`) | Admin. Counts and minor-unit totals by payment method, plus refunds. **Email summary** sends that text to `DAILY_SUMMARY_EMAIL` or `NOTIFY_ADMIN_EMAIL`. |
| Staff audit | Admin **Staff audit** and **Download audit CSV** | Admin. See above. |
| Price rules | Admin **Price rules** | Admin. Weekdays 0–6 (Sunday first) in `CLUB_TIMEZONE`. A court id limits the rule. The court rule wins over an all-courts rule. |
| Marketing opt-ins | Admin **Download marketing CSV** | Admin only. Columns are contact kind, contact, consent time, consent-text version, and source (`kiosk` or `playtomic`). People who did not opt in are absent. |
| One marketing message | Admin **Send to opted-in contact** | Admin. Refuses with "That contact has not opted in to marketing" when there is no active consent. |

**Not yet implemented:** tax reports and charts. The end-of-day total is not a tax filing. Card processing, refunds, and consent wording still need the club's attorney and CPA before live use.

The access log is deleted after `LOG_RETENTION_DAYS` (default 90). Check-ins, imported bookings, and resolved conflicts older than `VISIT_RETENTION_DAYS` (default 30) are deleted. The sweep runs at startup and about once an hour. Marketing rows are not part of that sweep.

## Privacy duties

Publish a notice you and your lawyer have edited. Start from [`templates/privacy-notice.md`](../../templates/privacy-notice.md). The in-app page `/privacy` repeats that it is not legal advice.

What the app stores is listed in that template: label, optional name, phone, email, membership type, household link, photo, linking keys, card ids, access log, check-in, guest count, guest contact, waiver version and time, and a separate marketing row only after opt-in or a Playtomic commercial-communications flag.

Duties you can carry out with the current software:

1. Leave the guest marketing box unchecked unless the person opts in. `CONSENT_TEXT_VERSION` and `WAIVER_TEXT_VERSION` are labels you bump when you change the text you showed them. The app does not store the text itself, only the version string (default `1`).
2. Set `VISIT_RETENTION_DAYS` to the visit lifetime you chose with counsel. Marketing contacts stay until unsubscribe or deletion.
3. Unsubscribe: the person submits their privacy token on `/privacy` (**Unsubscribe**), or you `POST /api/admin/marketing/unsubscribe` with `contactKind` (`email` or `phone`) and `contactValue`.
4. Deletion of that contact: `/privacy` **Delete this contact**, or `POST /api/privacy/delete` with the token. That clears the marketing contact value and the guest name and contact on the matching privacy token. It does not delete the member profile, the photo file, the linking key, or the access log.
5. Playtomic player email is stored so the desk can match a visit. It is copied into the marketing list only when `accepts_commercial_communications` is true. A later sync that reports false unsubscribes that Playtomic-sourced row and leaves kiosk consents alone.

**Not yet implemented:** deleting a member, wiping photos on a schedule, and filing a breach notice. Receipts, privacy links, household notices, and admin alerts (entry-pulse failure and Playtomic sync failure) are sent when email or SMS providers are configured. See [integrations](10-integrations.md). Marketing sends are a separate path and require opt-in.

If the club is in Florida, ask an attorney whether Florida Statutes section 501.171 applies to a breach of the personal information you store, and what notice that statute requires. This kit does not interpret that statute and is not a breach-notice form. Other places have their own rules. US state privacy laws, CAN-SPAM, the TCPA for texts, and the GDPR where it applies are questions for that attorney.

## Pricing configuration

The app does not contain a price list. You set numbers.

1. `CURRENCY` is a 3-letter code. `CURRENCY_DECIMALS` is how many digits follow the major unit (often 2). Both are required or the process will not start.
2. In Admin, add a court, then add a slot. Type the price in minor units every time. The form does not fill one in.
3. **Update price** works only while the slot is open. **Cancel slot** removes an open slot.
4. `DEFAULT_SLOT_PRICE_MINOR` is optional. It is used only by `POST /api/admin/slots/generate` when the body omits `priceMinor`. The admin page has no generate button. The body shape is in the [club-box README](../../reference/club-box/README.md). Times are in `CLUB_TIMEZONE`. A zero price is rejected.
5. LNbits also needs `SATS_PER_MINOR_UNIT`: how many sats you charge per minor unit. You choose that number. The app does not look up an exchange rate. BTCPay invoices in `CURRENCY` and converts on the BTCPay side, so this variable can stay empty for BTCPay.
6. `HOLD_MINUTES` is how long an unpaid invoice keeps the slot (default 15).

Do not copy prices from another club into this repo. The financial model template starts at zero on purpose.

## Playtomic credential setup

The API is read-only. It is offered on Playtomic Champion or Master plans. Credentials are created in Playtomic Manager under **Settings > Developer Tools**. Chain clubs request access through Playtomic. This app stores the client id, secret, and tenant id in the environment, not in the database and not in git.

Set all of these, or leave all three empty:

- `PLAYTOMIC_CLIENT_ID`
- `PLAYTOMIC_CLIENT_SECRET`
- `PLAYTOMIC_TENANT_ID`

`PLAYTOMIC_BASE_URL` defaults to `https://thirdparty.playtomic.io`. The client posts only to `/api/v1/oauth/token` and then uses GET for `/api/v1/bookings` and `/api/v1/payments`.

`PLAYTOMIC_SYNC_MINUTES` defaults to 15. `0` means no timer. Use **Sync now** in Admin. `PLAYTOMIC_PAGE_SIZE` defaults to 100 (maximum 200). `PLAYTOMIC_MIN_GAP_MS` defaults to 60000 because Playtomic documents about one call per minute. Use `0` only against a local mock.

After the first sync, map each Playtomic resource id to a local court: Admin **Playtomic courts**, pick the court, type the resource id, **Map court**. Unmapped active bookings raise a conflict and do not block a court. Mapped active bookings block overlapping Lightning holds.

**Not yet implemented:** a button to delete a map or to resolve a conflict. Those routes exist: `POST /api/admin/playtomic/maps/<id>/delete` and `POST /api/admin/playtomic/conflicts/<id>/resolve`.

Bookings older than about three months are not returned by Playtomic. Payments on the first call may answer HTTP 202 while a snapshot is built. The client waits for `Retry-After` and tries again. This app never writes a booking back. Two-way sync is [Playtomic Connect](https://playtomic.com/connect). Do not use an unofficial or scraped integration.
