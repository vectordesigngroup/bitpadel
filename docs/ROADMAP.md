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
- [x] **Club branding.** An owner or manager sets the club name, logo, favicon, colors, font, and footer on the admin page. Member pages, receipts, and email use it. The default stays the neutral placeholder and does not use the BitPadel name as the club's own. See [`brand/README.md`](../brand/README.md).
- [ ] **Tournaments.** Socials (Americano, Mexicano), round robins, brackets and leagues on the CourtHive [competition-factory](https://github.com/CourtHive/competition-factory) engine (MIT). Draws reserve courts so they block booking slots; players register with LNURL-auth, a card or the desk; entry fees by Lightning or card with refunds on withdrawal; signed kiosk check-in; a score counts only when both sides sign it; [TMX](https://github.com/CourtHive/TMX) as an optional desk for big events. Prizes (sats or fiat) come last and stay off until an attorney and a CPA have reviewed them. Plan: [`tournaments.md`](tournaments.md).
- [ ] Open workshop slide deck for the small-business Lightning curriculum.
- [ ] Spreadsheet version of the financial model (with charts).
- [x] **Translations.** Club-box pages, receipts, and outgoing email and texts can use English, Spanish, French, Italian, or Brazilian Portuguese. An admin sets the club default. A member's choice is saved on their profile, and the browser language is the fallback. The Spanish, French, Italian, and Brazilian Portuguese catalogs are machine drafts and need a native speaker. Waiver, consent, and door-safety lines also need a qualified reviewer in each country before a club relies on them. Portugal Portuguese is not a separate catalog yet. See [`translations.md`](translations.md).
- [ ] Case studies from clubs using the kit.
- [ ] **Padel and pickleball CRM.** One player page on the members, guests, bookings, and consent the app already stores, plus a lead list, tags, and campaigns on the existing email and SMS path. Plan: [`crm.md`](crm.md).
- [ ] **Digital waivers.** Players sign a liability waiver online before the first visit, and staff can see who has not signed. A Florida attorney must approve the waiver text; today's guest form only stores a version and a time, and members are not asked to sign.
- [ ] **Open play and leagues.** Drop-in sessions grouped by skill level, plus ladders and leagues that show standings. Skill uses the CRM player fields; event tournaments stay in the tournaments item above.
- [ ] **Coaches and lessons.** Coaches set times they can teach; a player books a lesson and pays by card or Lightning. A report lists those lesson payments, in the club's currency, so the club can pay the coach.
- [ ] **Peak and off-peak pricing.** The club types peak and off-peak prices on the weekday and time-window rules the admin page already stores (a member amount and a guest amount). The kit includes no sample prices.
- [ ] **Rentals.** Staff check out paddles, balls, and the ball machine, and charge by card or Lightning, or to the member tab once that ledger exists. Rental amounts are the club's to set.
- [ ] **Phone-friendly member app.** A page a member can add to their phone home screen, with court booking, door check-in, and the member tab in one place. The tab waits on the allowance and tab ledger; the app has no installable phone page today.

## Next: member perks on the same identity
Design notes for everything in this section and the next: [`lnurl-club-ideas.md`](lnurl-club-ideas.md). They reuse LNURL-auth identity (no sats move), the NFC card fallback, door `area` pulses and the booking window, plus the allowance and tab ledger.
- [x] **Allowance and tab ledger.** Per-member allowances (for example 2 waters per visit — an example, not a price), a tab settled by Lightning or card, guest items charged to the host member, and an append-only audit. Implemented in [`reference/club-box`](../reference/club-box). Design and the CPA / Florida attorney note: [`allowance-and-tab.md`](allowance-and-tab.md).
- [ ] **Member vending hardware.** The club-box device API can already charge a member by NFC card or LNURL at `/api/devices/vending/*`. Still open: a controller for a locked cooler or an MDB vending machine that calls that API.
- [ ] **Lockers.** Scan or tap to claim a locker for the visit and open it again; staff release from the admin page.
- [ ] **Booking-gated equipment.** Court lights, the ball machine and the gear rental cabinet work only during an active booking, with staff override.
- [ ] **Member-vouched guest passes.** A member signs to issue a one-day guest QR, within the guest cap and waiver rules.

## Later / ideas
- [ ] Streak and referral rewards through LNURL-withdraw. (Signed tournament check-in, two-sided score confirmation and tournament prizes moved to **Tournaments** under Next.)
- [ ] Coach tips through a Lightning address or LNURL-pay.
- [ ] Gift cards (LNURL-withdraw or Bolt Card).
- [ ] Member voting, one signature per member.
- [ ] Possibly new: late-cancel and no-show compensation, pay-per-minute equipment, rewards that grow with play frequency, a kiosk partner-finder board.

> Free allowances and sats rewards can have sales-tax and income-tax implications for the operator. Check with a tax advisor before turning them on.

## Ideas welcome
Open an issue with what your club needs.
