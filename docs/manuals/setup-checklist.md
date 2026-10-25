# Setup checklist

A short list for the first server. It is not a go-live approval. Permits, the lock, and the fire release stay with the installer and the AHJ. Card processing, refunds, customer data, and consent or waiver wording need the club's attorney and CPA before live keys. This page is not that review.

Use [installation](03-installation.md) for the commands and [integrations](10-integrations.md) for each provider.

1. Copy `reference/club-box/.env.example` to `.env`. Set `CURRENCY`, `CURRENCY_DECIMALS`, and a long `ADMIN_TOKEN`. Leave every secret empty until that provider is the one you mean to use.
2. Leave `PAYMENT_BACKEND=mock` and `DOOR_BACKEND=mock` until Lightning and the door are ready. Leave `CARD_PROVIDERS` empty. Leave `EMAIL_PROVIDER` and `SMS_PROVIDER` on `console` until you want mail or texts to leave the machine.
3. Start with `npm run dev` or `docker compose up --build`. Open `/api/health`. It should name the backends and list no secrets.
4. For HTTPS, use the Caddy service. `SITE_ADDRESS=localhost` is the local certificate. A public hostname needs DNS, `PUBLIC_BASE_URL=https://` that name, and `TRUST_PROXY=true`.
5. In Admin, add a court and a slot. Book it on `/` with Lightning. **Simulate payment** confirms a mock invoice. A real BTCPay or LNbits webhook replaces that button.
6. When you add cards, use a Stripe test key (`sk_test_`) and Square sandbox (`SQUARE_ENV=sandbox`). Register the webhook URLs `/api/webhooks/stripe` and `/api/webhooks/square`. Do not set `STRIPE_ALLOW_LIVE` or `SQUARE_ALLOW_LIVE` until counsel and the processor account are ready. There is no Bitcoin option on those APIs. Bitcoin at the pro shop, if the location is eligible, is Square Register or the Square POS app. See [integrations](10-integrations.md).
7. Add a price rule only after you have chosen the amounts with the club. Weekdays are 0 (Sunday) through 6 in `CLUB_TIMEZONE`.
8. Player login is `/account`. The code email is transactional. Set `CANCEL_WINDOW_HOURS` and `CANCEL_REFUND` to the club's written policy. Reminder checkboxes are separate from marketing opt-in.
9. Leave `BOOKING_ENTRY=false` until you have tested the door on the real lock with the installer. Fire release is not this software.
10. Schedule `npm run backup -- backup` on the host. Set `BACKUP_PASSPHRASE` if the file should be encrypted, and store that passphrase with the offline copy of `.env`. Copy `PHOTO_DIR` on the same schedule. Restore once onto a spare file before you rely on it.
11. Read **Staff audit** after a change. It should name who called the admin route.
12. Read **End of day** after a test booking. Email it only after `DAILY_SUMMARY_EMAIL` or `NOTIFY_ADMIN_EMAIL` points at a mailbox you control.
