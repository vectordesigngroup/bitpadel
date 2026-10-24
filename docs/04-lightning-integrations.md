# Lightning integrations

Three integrations make a club "Lightning-native": **booking**, **member access** and **the shop**. Reference code is planned (see the [roadmap](ROADMAP.md)); this doc describes the architecture so you can build or buy.

> Test everything with small amounts first. Lightning software changes quickly; check each project's current docs and wallet support before you commit.

## 1. Paying for court bookings with Lightning

### Options
| Option | What it is | Good for |
|---|---|---|
| **BTCPay Server** | Free, open-source, self-hosted payment processor (on-chain and Lightning via a connected node or Lightning provider). Invoices, POS app, webhooks, Greenfield API | Clubs that want full control and no processor fees |
| **LNbits** | Lightweight open-source Lightning accounts system with extensions (POS, paywalls, LNURL, events/tickets) on top of a funding source | Simple setups, events, experiments |
| **Hosted processors** | Third-party services with Lightning invoicing and APIs; some settle to local currency | Clubs that don't want to run infrastructure |

### Booking flow
1. Player picks a court and time in your booking tool.
2. The tool **holds the slot** and creates a Lightning invoice (price set in local currency, converted to sats at invoice time).
3. Player pays by scanning the QR or paying a Lightning address / LNURL-pay link.
4. The processor sends a **webhook** on settlement → the booking is confirmed and a confirmation is sent.
5. If the invoice expires unpaid, the hold is released.

### Practical notes
- **Existing booking platforms:** many sports booking apps don't support Lightning natively. Options: a Lightning checkout page that confirms bookings through the platform's API, a manual "paid by Lightning" step at the desk for a start, or a Lightning-native booking tool.
- **Refunds:** decide in advance: refund in sats or in local-currency value, via the customer's Lightning address, an LNURL-withdraw voucher, or store credit.
- **Records:** export every payment with its local-currency value at receipt for your bookkeeper.
- **Discounts for paying in Bitcoin:** check local rules on payment-method discounts and pricing disclosures before offering one.

## 2. Member-area access with a Lightning wallet (LNURL-auth)

Members unlock member-only areas (lounge, lockers, after-hours court) by signing in with their Lightning wallet. **LNURL-auth** (LUD-04) lets a wallet prove "I'm the same member as before" with a signature, without payments, passwords, email or revealing anything about the wallet's funds.

### Architecture
```
 ┌──────────────┐   scan QR    ┌───────────────┐
 │ Member wallet│◀────────────│ Door screen   │  shows a rotating QR with a fresh one-time challenge (k1)
 └──────┬───────┘              └───────────────┘
        │ signs k1 with its per-site linking key (LUD-05) and calls back
        ▼
 ┌───────────────────┐  is the key an active member?   ┌──────────────────┐
 │ Club access server│────────────────────────────────▶│ Member database  │
 └──────┬────────────┘                                  └──────────────────┘
        │ yes → unlock command (authenticated, local network)
        ▼
 ┌───────────────────┐   relay    ┌────────────────────────────┐
 │ Door controller   │──────────▶│ Electric strike / maglock  │  controls ENTRY only
 └──────┬────────────┘            └────────────────────────────┘
        │ also reads fobs/PIN (fallback), fire-alarm release, request-to-exit
        ▼
     audit log
```

### Steps
1. **Enroll:** when someone becomes a member, they scan an LNURL-auth QR on the club site. Their wallet derives a linking key just for your domain and signs a challenge. The server stores that public key with the member ID.
2. **Challenge:** the door screen shows a QR with a fresh, single-use `k1` that expires quickly.
3. **Sign:** the member scans it; the wallet signs `k1` and calls your server.
4. **Verify:** the server checks the signature, that `k1` is unused and unexpired, and that the key belongs to an **active** member allowed in that area at that time.
5. **Unlock:** the server sends an authenticated unlock command to the door controller, which pulses the lock relay briefly, and logs the event.
6. **Revoke:** lapsed memberships or lost phones remove the key; the member re-enrolls with a new wallet.

### Safety notes (non-negotiable)
- **Entry only, free egress always.** People must always be able to leave without a phone, wallet, power or network: panic/exit hardware, request-to-exit, and fire-alarm release for maglocks. Design with a licensed access-control installer and your fire marshal; follow your fire and building codes.
- **Fail-safe vs fail-secure** is chosen per door under code, not for convenience.
- **Offline behavior:** the controller must keep working (cached credentials or fobs) when the internet or server is down.
- **Always a non-wallet way in:** fobs/cards, PIN, staff or intercom, including for accessibility.
- **Insurance:** confirm your carrier is fine with app-based access and any unstaffed hours.

### Security notes
- Single-use `k1`, short expiry, server-side signature verification, rate limiting, TLS.
- Put the door controller on its own network segment; never expose an unauthenticated unlock endpoint to the internet.
- Log every attempt (success and failure) and review logs.

### Privacy notes
- The linking key is pseudonymous and different for each site, so it doesn't reveal the member's wallet, balance or other activity. Store only the public key, member ID and access log.
- Set a log retention period and explain it in your privacy policy.
- Not every wallet supports LNURL-auth; check current support and keep fobs available.

## 3. Lightning at the shop and events
- Use the same processor as bookings so all payments land in one place (BTCPay's POS app, an LNbits POS extension, or a hosted processor's POS).
- A tablet at the counter with a fixed QR for tips and a POS for items.
- Event tickets payable with Lightning (many tools support ticketing with LNURL or invoices).
- Train staff on: confirming a payment really settled, refunds, and spotting scams (fake "payment sent" screens).
