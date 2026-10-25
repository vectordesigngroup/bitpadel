# BitPadel

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)](LICENSE)

> **Prototype — not yet tested with real money or real doors.**

**An open "Bitcoin padel club in a box" kit.** Playbooks, templates and checklists for anyone starting a Bitcoin-friendly padel (and pickleball) club, from a single pilot court to a flagship venue.

> **Status:** early draft (v0.1). Playbooks and templates, plus a self-hosted reference app for Lightning booking, LNURL-auth and NFC entry, check-in, and optional read-only Playtomic sync in [`reference/club-box`](reference/club-box). Door-hardware notes are in that app's [compatible door hardware](reference/club-box/README.md#compatible-door-hardware) section. See the [roadmap](docs/ROADMAP.md) for what is still ahead.
> Nothing here is legal, tax or investment advice. Read the [DISCLAIMER](DISCLAIMER.md).

## The idea

Padel is a racquet sport played on an enclosed court, and many cities still have few or no courts. A BitPadel club puts padel and Bitcoin in the same room: one person shows a friend, then a group, then a whole community.

### Mission: a different way to "mine" Bitcoin

Bitcoin miners turn energy into blocks. A BitPadel club turns a different kind of energy, the energy of a sport and its community, into **Bitcoin adoption**: players, local businesses and neighbors who learn about Bitcoin, pay with Lightning, and come back for meetups and events.

This is a **metaphor for the mission, not a mining claim.** A BitPadel club does not mine Bitcoin, and joining, playing at or sponsoring a club does not earn anyone Bitcoin or any financial return.

## What's in the kit

| Path | What it covers |
|---|---|
| [`docs/01-concept-and-phases.md`](docs/01-concept-and-phases.md) | The model and how a club grows: pilot court → small club → flagship |
| [`docs/02-pilot-checklist.md`](docs/02-pilot-checklist.md) | Court, site, portable clubhouse, permits, insurance, staffing |
| [`docs/03-bitcoin-hub-playbook.md`](docs/03-bitcoin-hub-playbook.md) | Small-business Bitcoin conference curriculum, meetups, event rental, pro-shop Bitcoin corner |
| [`docs/04-lightning-integrations.md`](docs/04-lightning-integrations.md) | Lightning court booking, LNURL-auth member access with a door controller, Lightning at the shop |
| [`docs/05-tournaments-and-leagues.md`](docs/05-tournaments-and-leagues.md) | Socials, ladders, leagues, tournaments, prize rules |
| [`docs/06-community-growth.md`](docs/06-community-growth.md) | Waitlist, founding members, Reddit, Instagram, local partners |
| [`docs/07-sponsorship-playbook.md`](docs/07-sponsorship-playbook.md) | Sponsorship (not investment) packages and how to sell them |
| [`docs/08-treasury-policy-considerations.md`](docs/08-treasury-policy-considerations.md) | Questions to settle with a CPA and attorney before a business holds Bitcoin |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's done and what's next |
| [`docs/lnurl-club-ideas.md`](docs/lnurl-club-ideas.md) | Design notes: member vending, lockers, booking-gated equipment and other LNURL ideas |
| [`docs/manuals/`](docs/manuals/README.md) | Staff and operator manuals, including how a club plugs in its own providers |
| [`reference/club-box`](reference/club-box) | Self-hosted Lightning booking, LNURL-auth and NFC entry, check-in, and optional read-only Playtomic sync |
| [`templates/`](templates/) | Blank financial model (CSV with formulas), founding-member page, event run-of-show, sponsor one-pager |
| [`brand/`](brand/) | Neutral placeholder look you should replace with your own club's brand |
| [`media/promos/`](media/promos/) | Three 30-second promo videos (16:9 and 9:16) with posters and their Remotion source |

## Quick start

1. **Read** [`docs/01-concept-and-phases.md`](docs/01-concept-and-phases.md) and decide which phase you're starting with (most clubs should start with one pilot court).
2. **Fill in** [`templates/financial-model.csv`](templates/financial-model.csv) with your own local quotes. Every input starts at zero on purpose: the kit has no prices, because yours depend on your city, site and costs.
3. **Work through** [`docs/02-pilot-checklist.md`](docs/02-pilot-checklist.md) with your landlord or host site, your local permitting office and an insurance broker.
4. **Pick a Lightning stack** from [`docs/04-lightning-integrations.md`](docs/04-lightning-integrations.md). You can run the reference booking and entry app locally with its mock backend ([`reference/club-box`](reference/club-box)), then test a real node with small payments before opening.
5. **Start the community before the court:** a waitlist, a founding-member interest page ([`templates/founding-member-page.html`](templates/founding-member-page.html)) and a first Bitcoin meetup or small-business workshop ([`docs/03-bitcoin-hub-playbook.md`](docs/03-bitcoin-hub-playbook.md)).
6. **Talk to professionals** before you take money from the public or hold Bitcoin as a business: a local attorney, a CPA and an insurance broker.

## First club using the kit

**Gainesville Padel Club** in Gainesville, Florida is the first club building on these playbooks: <https://gainesvillepadel.club>. BitPadel is generalized from its planning work. Nothing in this repo is that club's pricing, plans or terms.

## Contributing

Club founders, coaches, Bitcoin educators and Lightning developers are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

- Code: [AGPL-3.0-only](LICENSE)
- Docs, playbooks, templates and brand placeholders: [CC BY-SA 4.0](LICENSE-docs)
- Names and logos: not licensed, see [TRADEMARKS.md](TRADEMARKS.md)

Commercial or other dual licensing is available on request. This page does not list prices.
