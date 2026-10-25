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

## Ideas welcome
Open an issue with what your club needs.
