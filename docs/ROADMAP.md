# Roadmap

## v0.1 (this release)
- Playbooks for concept and phases, pilot checklist, Bitcoin hub, Lightning integrations, tournaments, community growth, sponsorship and treasury considerations.
- Templates: blank financial model, founding-member page, event run-of-show, sponsor one-pager.
- Neutral placeholder brand.

## Next
- [x] **Reference code: Lightning court booking.** [`reference/club-box`](../reference/club-box) holds a slot, invoices through BTCPay Server (Greenfield), LNbits, or a local mock, confirms when the invoice settles, and releases unpaid holds. Prices come from configuration and the admin page.
- [x] **Reference code: LNURL-auth door access.** The same app enrolls a wallet, shows a rotating kiosk QR, checks the signature (expiry, replay, rate limit), pulses an entry-only controller, and writes an audit log. Safety rules are in [`04-lightning-integrations.md`](04-lightning-integrations.md) and on the kiosk page. Egress and life-safety stay outside this software. A fob, PIN, or staff path remains the fallback.
- [x] **Door hardware notes.** [`reference/club-box`](../reference/club-box/README.md#compatible-door-hardware) lists strike, maglock, lockset, and controller categories, with a wiring sketch and an installer checklist. Examples are not certifications.
- [x] **NFC member cards.** NTAG 424 DNA SUN and a DESFire proof, with enroll, revoke, and lost. UID-only mode is an explicit insecure switch and defaults off. Card programming is in [`nfc-card-programming.md`](nfc-card-programming.md).
- [x] **Profiles and guest check-in.** Optional name, phone, email, and photo; household; on-site list; guest cap; waiver; marketing opt-in stored apart from the visit. The notice template is [`templates/privacy-notice.md`](../templates/privacy-notice.md). It is not legal advice.
- [x] **Read-only Playtomic sync.** Optional import of bookings and payments. Imported time blocks Lightning holds. Two-way sync stays with Playtomic Connect. Scraped integrations are out of scope.
- [x] **Staff and operator manuals.** [`docs/manuals`](manuals/README.md) covers daily operations, admin, installation, maintenance, troubleshooting, security, training, emergencies, and contributors, plus one-page desk cards. Gaps the software does not cover are marked in those pages.
- [ ] Open workshop slide deck for the small-business Lightning curriculum.
- [ ] Spreadsheet version of the financial model (with charts).
- [ ] Translations (Spanish first).
- [ ] Case studies from clubs using the kit.

## Next: member perks on the same identity
Design notes for everything in this section and the next: [`lnurl-club-ideas.md`](lnurl-club-ideas.md). They reuse LNURL-auth identity (no sats move), the NFC card fallback, door `area` pulses and the booking window, plus a new allowance and tab ledger.
- [x] **Allowance and tab ledger.** Per-member allowances (for example 2 waters per visit — an example, not a price), a tab settled by Lightning or card, guest items charged to the host member, and an append-only audit. Implemented in [`reference/club-box`](../reference/club-box). Design and the CPA / Florida attorney note: [`allowance-and-tab.md`](allowance-and-tab.md).
- [ ] **Member vending hardware.** The club-box device API can already charge a member by NFC card or LNURL at `/api/devices/vending/*`. Still open: a controller for a locked cooler or an MDB vending machine that calls that API.
- [ ] **Lockers.** Scan or tap to claim a locker for the visit and open it again; staff release from the admin page.
- [ ] **Booking-gated equipment.** Court lights, the ball machine and the gear rental cabinet work only during an active booking, with staff override.
- [ ] **Member-vouched guest passes.** A member signs to issue a one-day guest QR, within the guest cap and waiver rules.

## Later / ideas
- [ ] Signed tournament check-in and two-sided score confirmation.
- [ ] Prizes, streak and referral rewards through LNURL-withdraw.
- [ ] Coach tips through a Lightning address or LNURL-pay.
- [ ] Gift cards (LNURL-withdraw or Bolt Card).
- [ ] Member voting, one signature per member.
- [ ] Possibly new: late-cancel and no-show compensation, pay-per-minute equipment, rewards that grow with play frequency, a kiosk partner-finder board.

> Free allowances and sats rewards can have sales-tax and income-tax implications for the operator. Check with a tax advisor before turning them on.

## Ideas welcome
Open an issue with what your club needs.
