# BitPadel manuals

These manuals are for club staff and operators who run the reference app in [`reference/club-box`](../../reference/club-box). They describe only what is in this repository: the app, its environment variables, scripts, pages, Docker Compose file, and the playbooks and templates next to it.

They are not legal, tax, fire-code, or locksmith instructions. Read the [disclaimer](../../DISCLAIMER.md). Door work belongs with a licensed installer and the authority having jurisdiction (AHJ), including the fire marshal. Where the software does not do a job a club might expect, the page says **not yet implemented**.

Card processing, refunds, the customer data this app stores, and the wording of consent and waiver text need review by the club's own attorney and CPA before a club takes real payments. This repository is not that review.

The app version in this tree is `0.1.0` (`reference/club-box/package.json`). The [roadmap](../ROADMAP.md) is the list of what is still ahead.

## Manuals

| Manual | Who it is for |
|---|---|
| [1. Operating](01-operating.md) | Front desk, daily open and close, check-in, bookings, lost cards |
| [2. Admin and manager](02-admin.md) | Profiles, households, tokens, privacy, prices, Playtomic credentials |
| [3. Installation and setup](03-installation.md) | Hardware categories, server, Docker, Caddy, environment, [setup checklist](setup-checklist.md), first run, go-live |
| [4. Maintenance](04-maintenance.md) | Schedules, backups, keys, door inspection, [log template](maintenance-log.md) |
| [5. Troubleshooting](05-troubleshooting.md) | Symptom, likely cause, and what to do |
| [6. Security and incidents](06-security-incident.md) | Token custody and incident playbooks |
| [7. Staff training](07-staff-training.md) | Onboarding, role cards, Lightning basics, quiz |
| [8. Emergency and life safety](08-emergency.md) | Power, fire, medical, evacuation. Verify locally. |
| [9. Developer and contributor](09-developer.md) | Layout, tests, new payment or card type, releases |
| [10. Integrations](10-integrations.md) | Email, SMS, storage, backup, door, and payment providers each club plugs in |

## One-page cards

Print these and keep them at the desk. They point at the longer manual when a step needs a manager.

| Card | Use |
|---|---|
| [Front desk check-in](quick-cards/front-desk-check-in.md) | Wallet, card, guests |
| [Lost card](quick-cards/lost-card.md) | Stop the old card and issue another |
| [Door fault](quick-cards/door-fault.md) | Entry pulse failed. People can still leave. |
| [Daily open and close](quick-cards/daily-open-close.md) | Start and end of the staffed day |

## Pages the app actually serves

| Page | Path |
|---|---|
| Court booking | `/` |
| Player bookings | `/account` |
| Admin | `/admin` |
| Door kiosk | `/kiosk` |
| Front desk | `/desk` |
| Named guest | `/guest` |
| Privacy choices | `/privacy` |
| Wallet enrollment | `/enroll` (opened from Admin) |

`GET /api/health` reports whether the process is up, which payment and door backends are selected, which card providers are enabled, which email, SMS, storage, and backup providers are selected, whether booking-linked entry is on, whether Playtomic credentials are set, and `controlsEgress: false` and `controlsLifeSafety: false`. It does not call Lightning, Stripe, or Square, and it does not include secrets. Admin **Check Lightning balance** is the optional liquidity check.

## What a full club manual would include that this software does not

**Not yet implemented:**

- Membership billing, family prices, or benefits that turn on because someone is in a household. Households can be edited in Admin and can email the primary. They do not bill.
- A tax report or chart. Admin **End of day** totals Lightning, Stripe, Square, and refunds for one club date. It is not a tax return.
- An automatic refund when a hold expires after the player paid. A manager can request a refund for a settled booking. A player can self-cancel inside `CANCEL_WINDOW_HOURS` when that refund is supported. LNbits needs a customer BOLT11 or it reports that the backend does not support an in-place refund.
- An in-app certificate manager. Compose includes Caddy as the TLS proxy. See [installation](03-installation.md).
- A battery, lock-sensor, or fire-alarm reading. Fire-alarm release stays wired in hardware. Software only pulses entry.
- A DESFire personalization tool or a DESFire reader bridge. Both are stubbed interfaces. `npm run card:program` still personalizes NTAG 424 DNA. The server can already check a DESFire proof if a reader posts one.
- Fob, PIN, or mechanical-key logic. Those are physical fallbacks outside this process.
- Any command that locks a door, holds it shut, or releases it for fire.
- Two-way booking sync. Playtomic Connect is a separate partner program. Scraped Playtomic integrations are out of scope.
- Shop point of sale, league brackets, or tournament software. Those topics stay in the playbooks.
- Automated releases or a changelog file.
- Deleting a member record, wiping photo files on the visit-retention timer, or sending a breach notice.
- An in-app scheduler. Back up with cron on the host. See [integrations](10-integrations.md).
