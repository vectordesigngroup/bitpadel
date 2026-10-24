# BitPadel manuals

These manuals are for club staff and operators who run the reference app in [`reference/club-box`](../../reference/club-box). They describe only what is in this repository: the app, its environment variables, scripts, pages, Docker Compose file, and the playbooks and templates next to it.

They are not legal, tax, fire-code, or locksmith instructions. Read the [disclaimer](../../DISCLAIMER.md). Door work belongs with a licensed installer and the authority having jurisdiction (AHJ), including the fire marshal. Where the software does not do a job a club might expect, the page says **not yet implemented**.

The app version in this tree is `0.1.0` (`reference/club-box/package.json`). The [roadmap](../ROADMAP.md) is the list of what is still ahead.

## Manuals

| Manual | Who it is for |
|---|---|
| [1. Operating](01-operating.md) | Front desk, daily open and close, check-in, bookings, lost cards |
| [2. Admin and manager](02-admin.md) | Profiles, households, tokens, privacy, prices, Playtomic credentials |
| [3. Installation and setup](03-installation.md) | Hardware categories, server, Docker, environment, first run, go-live |
| [4. Maintenance](04-maintenance.md) | Schedules, backups, keys, door inspection, [log template](maintenance-log.md) |
| [5. Troubleshooting](05-troubleshooting.md) | Symptom, likely cause, and what to do |
| [6. Security and incidents](06-security-incident.md) | Token custody and incident playbooks |
| [7. Staff training](07-staff-training.md) | Onboarding, role cards, Lightning basics, quiz |
| [8. Emergency and life safety](08-emergency.md) | Power, fire, medical, evacuation. Verify locally. |
| [9. Developer and contributor](09-developer.md) | Layout, tests, new payment or card type, releases |

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
| Admin | `/admin` |
| Door kiosk | `/kiosk` |
| Front desk | `/desk` |
| Named guest | `/guest` |
| Privacy choices | `/privacy` |
| Wallet enrollment | `/enroll` (opened from Admin) |

`GET /api/health` reports whether the process is up, which payment and door backends are selected, whether Playtomic credentials are set, and `controlsEgress: false` and `controlsLifeSafety: false`.

## What a full club manual would include that this software does not

**Not yet implemented:**

- Named staff logins, a coach role, or per-person permissions. The app has an admin token and an optional staff token.
- Buttons for households, membership type, per-member guest cap, or photo upload. Those exist as admin API calls. The admin page does not show them.
- Membership billing, family prices, or benefits that turn on because someone is in a household.
- Email or SMS, including payment receipts and breach notices.
- Refunds. Settlement is recorded. Sats are not sent back.
- A date-filtered sales report. The bookings CSV is the latest 500 settled Lightning bookings. Playtomic payment rows are stored in SQLite and have no page and no export.
- A backup command, a restore command, or a log file. Logs are JSON lines on the process output. The access log is rows in SQLite.
- A bundled TLS proxy or certificate manager.
- A Lightning-node or channel-liquidity check inside this app.
- A GPIO door driver. The example relay speaks HTTP and does not toggle pins.
- A DESFire personalization tool. The programming command personalizes NTAG 424 DNA.
- A reader bridge that runs a DESFire session. The bridge reads an NDEF URL and requests it.
- Fob, PIN, or mechanical-key logic. Those are physical fallbacks outside this process.
- Any command that locks a door, holds it shut, or releases it for fire. Egress hardware stays on other circuits.
- Two-way booking sync. Playtomic Connect is a separate partner program. Scraped Playtomic integrations are out of scope.
- Shop point of sale, league brackets, or tournament software. Those topics stay in the playbooks.
- Automated releases or a changelog file.
