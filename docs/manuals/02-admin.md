# Admin and manager manual

Tasks that need the admin token. Desk staff procedures are in the [operating manual](01-operating.md).

Nothing here is legal advice. Privacy text in the app is a template. Have a lawyer review what you publish. The [disclaimer](../../DISCLAIMER.md) covers the rest of the kit.

## How admin access works

Open `/admin`, paste `ADMIN_TOKEN`, and submit. The browser keeps it in `sessionStorage` for that tab. Closing the tab drops it. There is no user name and no second factor.

`STAFF_TOKEN` is optional. If it is set (at least 16 characters), the desk, the on-site list, checkout, staff photos, today's Playtomic list, and the conflict list accept the staff token or the admin token. Marketing export, member edits, court prices, card issue, and Playtomic sync accept only the admin token.

**Not yet implemented:** roles, a coach account, an audit of which person used the token, and a way to expire one person's copy of the token without changing it for everyone. Rotating the token is in the [security manual](06-security-incident.md).

## Member profiles

1. **Add a member.** The label is a membership number or similar handle. The new member is active.
2. Fill **Display name**, **Email**, **Phone**, and **Playtomic player id** only if your notice says you collect them. Press **Save profile**. Empty text clears that field. The Playtomic id is how a later check-in matches today's import when the emails differ.
3. **Revoke member** blocks wallet and card entry. **Restore member** makes the membership active again. Restored members still need a key or card that was not revoked.
4. **Enrollment QR** then **Open enrollment page** is the one-time wallet enroll. The linking key is a public key for this site. It is not a balance and not a payment key.

The profile API also accepts `membershipType` and `guestLimit`. Allowed type ids are `MEMBERSHIP_TYPES` (default `standard,household`). `guestLimit` overrides `GUEST_LIMIT` for that member. Send `null` to clear the override.

**Not yet implemented:** those two fields on the admin page. A manager who needs them sends `POST /api/admin/members/<id>/profile` with header `Authorization: Bearer <ADMIN_TOKEN>` and a JSON body. Example shape, with your own values:

```json
{
  "displayName": "Member name",
  "membershipType": "household",
  "guestLimit": 1
}
```

Photos use `POST /api/admin/members/<id>/photo` with JSON `data` (base64) and `contentType`. Files land in `PHOTO_DIR`, or in a `photos` directory next to the SQLite file if `PHOTO_DIR` is unset. The kiosk shows the photo after a successful unlock, using that visit's token. The desk loads it with the staff or admin token. The public booking page does not get the file.

**Not yet implemented:** a photo picker on the admin page, and automatic deletion of the file when a visit is purged.

## Family plans

"Family" in this app is a household record, not a priced plan.

1. `POST /api/admin/households` with JSON `label` and `primaryMemberId`. The primary member's role becomes `primary`.
2. `POST /api/admin/households/<id>/members` with JSON `memberId` and `role` of `primary` or `dependent`.

Each person unlocks only with their own enrolled wallet or card. The household does not bill anyone and does not raise the guest cap.

**Not yet implemented:** a household screen, invoices for a family plan, and shared entry.

## Reports and data you can actually pull

| What | Where | Who |
|---|---|---|
| Server snapshot | Admin **Server**, or `GET /api/health` | Health is public. It has backends, areas, guest cap, and whether NFC and Playtomic are configured. It has no member data. |
| Lightning bookings | Admin list, and **Download CSV** (`GET /api/admin/bookings.csv`) | Admin. Latest 500 settled rows. Columns include minor units, currency, sats if stored, payment reference, confirmed time. |
| Access attempts | Admin **Access log** (`GET /api/admin/audit`) | Admin. Time, result, reason, area. |
| Who is on site | `/desk` | Staff or admin. |
| Today's Playtomic bookings and conflicts | `/desk` and Admin **Playtomic courts** | Staff or admin for the lists. Sync and mapping are admin. |
| Marketing opt-ins | `GET /api/admin/marketing.csv` | Admin only. Columns are contact kind, contact, consent time, consent-text version, and source (`kiosk` or `playtomic`). People who did not opt in are absent. |

**Not yet implemented:** a button for the marketing CSV (open the path with the admin bearer token, the same way the bookings download sends the token from the admin page), a date range, tax reports, Playtomic payment export, and charts. Stored Playtomic payments are reconciliation fields only: ids, status, total text, dates, product SKU.

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

**Not yet implemented:** sending the notice, emailing a privacy link, deleting a member, wiping photos on a schedule, and filing a breach notice. The app does not send email or SMS.

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
