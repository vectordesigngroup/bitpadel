# Translations

The club-box reference app can show pages, receipts, and outgoing email and texts in English, Spanish, French, Italian, and Brazilian Portuguese. That includes the booking calendar and the daily court grid.

Spanish (`es`), French (`fr`), Italian (`it`), and Brazilian Portuguese (`pt-BR`) are **machine drafts**. A native speaker should review them before a club relies on the wording. They are a starting point, not a finished translation.

## Legal and safety wording

Some strings are waivers, disclaimers, consent, opt-out lines, or door-safety text. A translation is not approval to use them. A qualified reviewer in each country has to approve that wording before a club relies on it. The keys are listed in [`reference/club-box/locales/review.json`](../reference/club-box/locales/review.json) under `legalReviewKeys`. That includes the guest waiver, the marketing checkbox, the privacy page, the kiosk and door safety lines, the reminder opt-in, and the allowance note that asks for a CPA and a Florida attorney.

## How the app picks a language

1. A `?lang=` link applies to that page only, and also stores a session cookie so the next page in this browser matches.
2. A logged-in member's saved language beats the cookie.
3. The session cookie beats the browser's `Accept-Language` header.
4. The browser language is used when it matches a catalog. `es-MX` uses Spanish. `fr-CA` uses French. `pt` and `pt-PT` use Brazilian Portuguese until a Portugal catalog exists.
5. Otherwise the club's default language is used. An owner or manager sets that on Admin, in Branding, next to the name and colors.
6. English is the last fallback.

The language menu is on the booking page, My bookings, the kiosk, the guest form, enrollment, privacy, the desk, and Admin. Choosing a language there saves it for this browser until the browser closes. After a member logs in, the same choice is saved on their profile. Email and texts use the recipient's saved language. A booking made before login keeps the language of that page on the receipt.

The NFC tap page is translated from the member's saved language, then the browser, then the club default. It does not show the language menu. Reloading that address would pulse the door again.

Club-written text stays as the club wrote it: the club name, footer, contact line, and footer link labels.

## Add a language

Catalogs are JSON files in [`reference/club-box/locales/`](../reference/club-box/locales/). One file per language. Keys are flat strings such as `booking.heading`. Placeholders look like `{name}` and must match the English file exactly.

1. Copy `locales/en.json` to `locales/<id>.json`. Use a BCP 47 id, for example `pt-PT`.
2. Translate every value. Leave product names as they are: Lightning, Stripe, Square, BitPadel, sats.
3. Add the id to `LOCALE_IDS` in `reference/club-box/src/i18n/locales.ts`, and add a name in `localeName`. The `default` branch must stay a `never` check.
4. If the new file replaces an alias, delete that alias. Portuguese from Portugal is the planned case: add `pt-PT` to `LOCALE_IDS` and remove the `pt-pt` line from `LOCALE_ALIASES`. The bare tag `pt` can keep pointing at `pt-BR`, or you can point it at `pt-PT` if that is the club's choice. Say which you picked in the pull request.
5. Add the language to the `<select>` on each page that has `class="locale-switch"`, and to the default-language list on the admin branding form.
6. Run `npm test` and `npm run typecheck` in `reference/club-box`. The suite fails if any English key, or any `{placeholder}`, is missing.

Dates, times, numbers, and money use `Intl` in the club timezone (`CLUB_TIMEZONE`). The word `sats` stays `sats` in every catalog. Grouping changes with the language, so Spanish shows `1.000 sats`.

No catalog is loaded from another website. The server embeds the strings in the page.

## Submit a translation

Open a pull request that changes the JSON catalog, and say whether a native speaker reviewed it. Do not change prices, club facts, or legal conclusions inside a translation. Do not add investment, return, treasury, or lifetime wording. If you correct a machine draft, remove that language from the "machine draft" note in this file and in `locales/review.json` only after a person who speaks the language has reviewed the whole file. Leave `legalReviewKeys` flagged until a qualified reviewer for that country has approved them.

Staff-composed marketing text is sent as the staff member wrote it. The app does not translate that text.

## Still in English

These stay in English for now:

- Lists the admin page builds after it loads: slots, bookings, the ledger, the access log, contrast warnings, and most status lines.
- Buttons on a member card other than the profile fields and the preferred-language list (enrollment, revoke, household, card issue, tab).
- Error messages returned by the API.
- Playtomic import labels and conflict text.
- The club's own name, footer, and contact line.
