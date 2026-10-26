# Tournaments: design plan

Status: **plan, not built.** Nothing on this page exists in `reference/club-box` yet. The roadmap entry is in [ROADMAP.md](ROADMAP.md#next). Formats and event-day advice are in [tournaments and leagues](05-tournaments-and-leagues.md); this page is the software plan.

> **Before launch: prizes and entry fees need legal and tax review.** Read [Compliance](#compliance-read-before-launch) first. Nothing here is legal or tax advice.

## Goal

Run club tournaments, leagues and social nights (Americano, Mexicano) on the same identity, payments and courts that club-box already uses:

- Players register with the wallet they already use for the door (LNURL-auth), or an NFC card or the staff desk.
- Entry fees go through the existing payment backends (Lightning or card), with refunds when a player withdraws in time.
- Tournament matches reserve courts, so nobody can book a court that a draw needs.
- Players check in at the kiosk by signing, and a score counts only after both sides sign it.
- Prizes, when the club offers them, are fixed and recorded, and paid only after legal review.

## Building blocks

### Competition engine: CourtHive competition-factory (dependency)

[CourtHive/competition-factory](https://github.com/CourtHive/competition-factory), published on npm as [`tods-competition-factory`](https://www.npmjs.com/package/tods-competition-factory).

| Check (on 2026-10-25) | Result |
|---|---|
| License | MIT (GitHub and npm agree) |
| Maintained | Yes. Commits on 2026-10-25; releases 7.20.1 (Oct 23), 7.21.0 (Oct 24), 7.22.0 (Oct 25). Not archived, 6 open issues. |
| Size | Zero runtime dependencies. npm package about 24 MB unpacked (it ships several builds plus source maps); the git repository is about 125 MB. |
| Runtime | Requires **Node.js 24 or later** (`engines.node >= 24`). club-box currently requires Node 22.13. See [Open questions](#open-questions). |
| Adoption | About 18,000 npm downloads in the month to 2026-10-22. |

What it gives us (all present in the 7.22.0 type definitions):

- **Draws:** single and double elimination, round robin, round robin with playoff, Swiss, feed-in championship, first-match loser consolation, compass, lucky draw, ladder, ad hoc rounds, and DrawMatic (skill-based flexible pairing). Created with `generateDrawDefinition` and `addDrawDefinition`.
- **Americano and Mexicano:** supported as rotating-partner formats (`generateRotatingPartnerRound`, `getRotatingPartnerRoundPreview`, `getRotatingPartnerStandings`, `settleRotatingPartnerResult`). Each round records its seed and pairings, so a round can be reproduced and audited. Mexicano pairs by adjacent standings (1st and 4th against 2nd and 3rd).
- **Participants and entries:** individuals and pairs (`addParticipants`, `addEventEntries`, `modifyEntriesStatus`), sign-in state (`checkInParticipant`, `checkOutParticipant`), and a payment status field (`getParticipantPaymentStatus`). club-box stays the source of truth for payments; the engine only mirrors "paid / not paid".
- **Scheduling:** venues and courts with availability windows (`addVenue`, `addCourts`, `modifyCourtAvailability`), automatic scheduling (`scheduleMatchUps`, `scheduleProfileRounds`, `proAutoSchedule`) with match-length estimates and recovery times, and conflict detection.
- **Scores:** `setMatchUpStatus` records results and moves winners on; a point-by-point scoring engine exists if we ever want live scoring.
- **Ladders:** self-reported results with peer or operator confirmation and a dispute state, which matches our two-sided confirmation.
- **Ratings:** dynamic ratings from results, if a club wants them later.

How we use it:

1. club-box stores one tournament record (CODES/TODS JSON) per event in SQLite, plus our own tables for money, identity and court blocks ([data model](#data-model-sketch)).
2. Every change (add entry, generate draw, record score) loads the record into `tournamentEngine`, runs the method, checks the result, and saves the new record in the same SQLite transaction as our own rows.
3. Court time comes from club-box. Before scheduling, we load our courts and their free windows into the engine as venue courts. After scheduling, we turn each scheduled match into a court block (next section).
4. Pin an exact version. The project releases almost daily, so upgrade on purpose, run our tests, and read its changelog.

### Court blocks: tournaments take booking slots

A tournament reserves court time the same way Playtomic imports already do: booking code refuses holds that overlap a block.

- Staff pick the courts and the time window for the event. club-box creates `tournament_blocks` rows and refuses the change if a paid booking already overlaps (staff must move or refund that booking first; the app never cancels a paid booking on its own).
- The engine schedules matches only inside those blocks.
- `booking/service.ts`, `booking/claim.ts` and `booking/source.ts` already check `external_bookings`; the same overlap check would also read `tournament_blocks`.
- When the event ends early, staff release the remaining blocks and the slots reopen.
- Door rules: an active tournament block can open the venue area for checked-in players during the block, like `BOOKING_ENTRY` does for a booking.

### TMX: optional tournament desk (separate service)

[CourtHive/TMX](https://github.com/CourtHive/TMX) (MIT, active on 2026-10-25) is a full tournament desk built on the same engine: court grid with drag and drop, order of play, check-in, desk score entry and delegated live scoring, sign-in sheets and PDFs, and multi-user collaboration.

- **Use it for big events** where a desk person wants a court grid and printouts. Small socials and leagues should not need it.
- **Run it beside club-box, not inside it.** It is a separate browser app. We do not vendor its code.
- **Exchange the record, not the database.** club-box exports the tournament record (entries, paid and checked-in flags, court blocks as court availability) for TMX to import, and imports the updated record back. On import, club-box only accepts schedule and score changes that stay inside its court blocks, and keeps its own signed confirmations and money rows.
- TMX's live collaboration uses its own server stack; we have not evaluated running that server. Start with export and import of the record.

## Player registration (LNURL-auth identity)

- **Existing members:** scan the event QR with the wallet they enrolled for the door. Same LNURL-auth flow as the kiosk: one-time challenge, signature check, expiry and replay checks. No sats move. The server maps the key to `members.id`.
- **Card fallback:** tap the NFC member card at the desk or kiosk.
- **New players:** register through the existing player email-code login (`players` table), or staff add them at the desk. They can enroll a wallet later.
- **Pairs:** one player registers and invites a partner; the partner accepts by signing (or staff confirm). The pair is created in the engine only after both accept.
- **Required at registration:** waiver acceptance (reuse the check-in waiver), skill level or rating, and consent for photos or streaming if the event is filmed. Marketing opt-in stays separate, as it is today.
- The engine stores a participant id and a display name only. Phone and email stay in club-box.

## Entry fees and refunds

- **Pricing:** each event (or division) has an entry fee set by staff, per player or per pair. This page does not set amounts.
- **Lightning:** the entry creates an invoice through the configured backend (BTCPay, LNbits or mock), exactly like a booking hold. The entry stays `pending` until the invoice settles; unpaid entries expire and free the spot.
- **Card:** optional Stripe or Square checkout, through the same card backends bookings use.
- **Desk payment:** staff can mark cash or comp entries, recorded in the staff audit log.
- **Capacity:** an event has a maximum number of entries. Paid entries above it go to a waitlist; promotion from the waitlist sends a new invoice.
- **Withdrawal and refunds:** reuse the `refunds` table and backend refund paths.
  - Before the withdrawal deadline: full or partial refund, as the event rules say.
  - After the draw is made or after the deadline: no refund unless staff approve one.
  - Lightning refunds need the player's own BOLT11 invoice and `LNBITS_ADMIN_KEY`, and the app refuses an invoice for more sats than were paid, as it already does for bookings.
  - Card refunds go back through Stripe or Square.
  - If the club cancels the event, every paid entry is refunded.
- **Records:** every entry, payment, refund and comp is an append-only row and shows in the daily and sales reports.

## Signed check-in at the kiosk

- The kiosk shows an event check-in QR (rotating, like the door QR). The player signs with their wallet or taps their card.
- The server checks that the player has a paid entry for an event that starts within the check-in window, then calls `checkInParticipant` in the engine and writes a `tournament_checkins` row with the key or card used.
- A pair counts as checked in when both players have checked in (or staff check in the missing partner).
- Staff can check players in or out at the desk with a reason, recorded in the staff audit log.
- The check-in screen and TV wall show who is still missing before draws are finalized.

## Two-sided score confirmation

- After a match, one player on either side enters the score at the kiosk or on their phone and signs it. That creates a **proposed** result tied to the match id and a hash of the score.
- One player from the **other** side signs the same score hash to confirm. Only then does club-box call `setMatchUpStatus` (or `settleRotatingPartnerResult` for Americano and Mexicano) and the result counts.
- If the other side signs a different score, or rejects it, the match is **disputed** and goes to staff, who decide and sign as staff.
- A proposal that nobody confirms by a deadline goes to staff too. Staff can also enter a score directly (with an audit entry), for players without a wallet.
- Every signature is stored with the key, the challenge and the time, so anyone can check later who agreed to which score.
- Ratings, standings and any prize decisions use confirmed results only.

## Prizes (fiat or sats)

- **Kinds:** trophies and gear, sponsor goods, gift cards or court credit, and sats or cash. Non-cash prizes are the simplest.
- **Fund the prize first**, ideally from a named sponsor, and publish fixed prize amounts in the official rules before registration opens. Avoid prize pools that grow with the number of entries until a lawyer has approved the structure.
- **Paying sats:** a one-time LNURL-withdraw link or QR per winner, with an amount cap and an expiry (LNbits can already create withdraw links). One claim per winner, recorded in `tournament_prizes`.
- **Paying fiat:** cash or bank transfer by the club, recorded the same way.
- **Records for tax:** winner identity, prize value in dollars on the award date, and how it was paid. Collect whatever tax forms the CPA says are needed **before** paying.
- Prize payout stays switched off by default (`TOURNAMENT_PRIZES=off`) until the operator turns it on after legal review.

## Data model sketch

New tables, all `STRICT`, in the same style as `db.ts`:

| Table | Key columns | Notes |
|---|---|---|
| `tournaments` | `id`, `name`, `status` (`draft`, `open`, `closed`, `running`, `finished`, `cancelled`), `starts_at`, `ends_at`, `record_json`, `factory_version`, `updated_at` | `record_json` is the engine's tournament record |
| `tournament_events` | `id`, `tournament_id`, `engine_event_id`, `name`, `format`, `entry_kind` (`single`, `pair`), `fee_minor`, `currency`, `max_entries`, `withdraw_deadline` | One division or format |
| `tournament_entries` | `id`, `event_id`, `member_id` or `player_id`, `partner_entry_id`, `engine_participant_id`, `status` (`pending`, `paid`, `waitlist`, `withdrawn`, `refunded`, `comp`), `invoice_id`, `amount_minor`, `amount_sats`, `created_at`, `paid_at` | Payment fields match `holds` |
| `tournament_blocks` | `id`, `tournament_id`, `court_id`, `starts_at`, `ends_at`, `released_at` | Booking checks treat these like `external_bookings` |
| `tournament_checkins` | `id`, `entry_id`, `method` (`lnurl`, `card`, `staff`), `credential_ref`, `k1`, `at` | Append-only |
| `score_reports` | `id`, `tournament_id`, `engine_matchup_id`, `score_json`, `score_hash`, `side`, `member_id`, `k1`, `signature`, `kind` (`propose`, `confirm`, `reject`, `staff`), `at` | Append-only; a result needs one row from each side or one staff row |
| `tournament_prizes` | `id`, `tournament_id`, `entry_id`, `kind`, `amount_minor`, `amount_sats`, `withdraw_id`, `status`, `paid_at`, `tax_note` | Off by default |

Refunds reuse the existing `refunds` table (with a reference to the entry). Staff changes go in `staff_actions`.

## API sketch

Public and player routes (rate-limited like the existing ones):

| Method and path | What it does |
|---|---|
| `GET /api/tournaments` | Open and upcoming events |
| `GET /api/tournaments/:id` | Event details, entries (display names only), draw and schedule when published |
| `POST /api/tournaments/:id/events/:eventId/entries` | Start registration; responds with an LNURL-auth challenge or uses the player session |
| `GET /api/tournaments/entries/:entryId/pay` | Invoice or card checkout for the entry fee |
| `POST /api/tournaments/entries/:entryId/withdraw` | Withdraw; body may include `bolt11` for a Lightning refund |
| `GET /lnurl/tournament-checkin?tag=login&k1=...` | Kiosk check-in callback (LNURL-auth) |
| `POST /api/matches/:matchUpId/score` | Propose a score; responds with a challenge to sign |
| `GET /lnurl/score?k1=...` | Signature callback for propose, confirm or reject |
| `GET /api/tournaments/:id/standings` | Confirmed results and standings only |

Staff routes (staff login and permissions as today):

| Method and path | What it does |
|---|---|
| `POST /admin/tournaments` | Create a tournament and its events |
| `POST /admin/tournaments/:id/blocks` | Reserve courts; refuses overlaps with paid bookings |
| `POST /admin/tournaments/:id/draws` | Generate or regenerate a draw (before it is published) |
| `POST /admin/tournaments/:id/schedule` | Auto-schedule inside the blocks |
| `POST /admin/tournaments/:id/rounds` | Next Americano or Mexicano round |
| `POST /admin/matches/:matchUpId/resolve` | Settle a dispute or enter a staff score |
| `POST /admin/tournaments/entries/:entryId/refund` | Staff refund |
| `GET /admin/tournaments/:id/export` and `POST /admin/tournaments/:id/import` | Record exchange with TMX |
| `POST /admin/tournaments/:id/prizes` | Record and pay prizes (only when prizes are on) |

## Phased build plan

1. **Engine spike.** Resolve the Node version question. Add the pinned dependency and a `THIRD_PARTY_NOTICES` entry. Prove create event, add players, generate a round robin and an Americano round, record scores, read standings, in tests only.
2. **Socials and round robins, staff-run.** Tournament tables, court blocks wired into booking checks, staff create events and enter scores. Free events only. TV wall view of draws and standings.
3. **Registration and entry fees.** LNURL-auth and card or email registration, Lightning and card entry fees, waitlist, withdrawal with refunds, reports. Test on regtest and with small real amounts first.
4. **Signed check-in and two-sided scores.** Kiosk check-in, propose and confirm flow, disputes to staff, standings from confirmed results only.
5. **Brackets and scheduling.** Elimination and group-plus-knockout draws, automatic scheduling into blocks, TMX export and import for big events.
6. **Prizes.** Only after the attorney and CPA review in [Compliance](#compliance-read-before-launch). LNURL-withdraw for sats, fiat records, tax records. Off by default.
7. **Later.** Leagues and ladders over weeks, ratings from confirmed results, kiosk partner-finder.

## Open questions

- **Node version:** competition-factory needs Node 24 or later, and club-box supports Node 22.13 or later. Raise club-box to Node 24, or run the engine in a small separate process on Node 24?
- Store the full tournament record as JSON (simple, matches the engine) or split more of it into tables for reporting?
- Withdrawal deadline and refund rules: one club-wide default, or set per event?
- Pair entry fees: one player pays for the pair, or each pays half?
- Score entry for players without a wallet: email-code session signing, staff only, or the NFC card?
- Do we want ratings at all at launch, and if so, our own or an existing padel rating?
- Is TMX worth supporting for a one- or two-court club, or only for multi-club events?
- Prize structure that the attorney is comfortable with (fixed sponsor-funded prizes versus anything tied to entry fees).

## License compatibility

- BitPadel code is AGPL-3.0-only; these docs are CC BY-SA 4.0.
- competition-factory and TMX are **MIT**. MIT code can be used inside an AGPL project. Keep their copyright and license notice in a `THIRD_PARTY_NOTICES` file when the dependency is added.
- We use competition-factory as an npm dependency, not copied source. TMX runs as a separate app; we do not vendor it.
- **Do not copy GPL code** (for example GPL-3.0 scoreboard or tracking projects) into BitPadel. Read those for ideas only, or ask the maintainers about licensing first.
- Do not reuse code from repositories with no license; no license means no permission.

## Compliance (read before launch)

- **Prizes paid from entry fees:** an event where players pay to enter and win sats or cash funded by those fees may fall under **Florida** gambling, game-promotion, or contest rules, depending on how prizes are funded and decided. Have a **Florida attorney** confirm the structure (for example skill contest with fixed, pre-funded prizes) and review the official rules **before** entry fees and cash or sats prizes are combined.
- **Tax:** sats and cash prizes are generally taxable to the winner, and the club may have reporting duties (tax forms above certain amounts). Entry fees are club income, and sales tax may apply. Bitcoin received as entry fees and paid as prizes needs cost-basis records. Have a **CPA** set this up before launch.
- **Refunds and card processing:** refund terms belong in the published event rules; card processors have their own rules for contests and prizes. Check the processor terms.
- **Waivers and consent:** reuse the waiver; get photo and streaming consent at registration.
- This page is not legal or tax advice.
