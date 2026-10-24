# Roadmap

## v0.1 (this release)
- Playbooks for concept and phases, pilot checklist, Bitcoin hub, Lightning integrations, tournaments, community growth, sponsorship and treasury considerations.
- Templates: blank financial model, founding-member page, event run-of-show, sponsor one-pager.
- Neutral placeholder brand.

## Next
- [x] **Reference code: Lightning court booking.** [`reference/club-box`](../reference/club-box) holds a slot, invoices through BTCPay Server (Greenfield), LNbits, or a local mock, confirms when the invoice settles, and releases unpaid holds. Prices come from configuration and the admin page.
- [x] **Reference code: LNURL-auth door access.** The same app enrolls a wallet, shows a rotating kiosk QR, checks the signature (expiry, replay, rate limit), pulses an entry-only controller, and writes an audit log. Safety rules are in [`04-lightning-integrations.md`](04-lightning-integrations.md) and on the kiosk page. Egress and life-safety stay outside this software. A fob, PIN, or staff path remains the fallback.
- [ ] Open workshop slide deck for the small-business Lightning curriculum.
- [ ] Spreadsheet version of the financial model (with charts).
- [ ] Translations (Spanish first).
- [ ] Case studies from clubs using the kit.

## Ideas welcome
Open an issue with what your club needs.
