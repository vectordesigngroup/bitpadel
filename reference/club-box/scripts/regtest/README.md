# Regtest Lightning harness

End-to-end checks for club-box against real Lightning nodes on **regtest**. Regtest coins are created locally and have no value. Nothing here touches mainnet or testnet, and both `start.sh` and `e2e.ts` stop if a node reports any chain other than `regtest`.

## What it starts

Native binaries, no Docker. `start.sh` downloads pinned releases into `.state/bin` and checks their SHA-256:

| Piece | Version | Ports (127.0.0.1) |
| --- | --- | --- |
| bitcoind (regtest) | 28.1 | RPC 18443, ZMQ 28332/28333 |
| LND node A, the LNbits funding source | v0.18.5-beta | p2p 9735, gRPC 10009, REST 8081 |
| LND node B, the "player wallet" | v0.18.5-beta | p2p 9736, gRPC 10010 |
| LNbits on node A (`LndRestWallet`) | v1.6.2 | HTTP 5000 |
| Node.js for club-box | v22.21.0 | — |

It then mines 101 blocks, funds node B with 5 BTC, opens a 5,000,000-sat channel from B to A, creates an LNbits wallet, and pays a 100,000-sat float into it from B (refunds need it). Keys and paths go to `.state/state.json` (gitignored).

Needs Linux x86-64, `curl`, `jq`, `git`, and [`uv`](https://docs.astral.sh/uv/) for LNbits. The first run downloads about 115 MB of releases plus the LNbits Python dependencies.

LNbits runs with `LNBITS_CALLBACK_ALLOW_PRIVATE_IPS=true` and `LNBITS_LNURL_ALLOW_PRIVATE_IPS=true` so it can call the local club-box webhook. Do not copy those settings to a real install.

## Run

```sh
cd reference/club-box
npm ci
./scripts/regtest/start.sh
PATH="$PWD/scripts/regtest/.state/bin/node-v22.21.0-linux-x64/bin:$PATH" npx tsx scripts/regtest/e2e.ts
./scripts/regtest/stop.sh
```

`e2e.ts` starts its own club-box on port 3100 (LNbits backend, 1-minute holds, `CANCEL_REFUND=full`, SMTP sink on 2525 for player login codes) and takes about 75 seconds, most of it waiting for a hold to expire. It prints PASS / FAIL / N/A per case and writes `.state/e2e-<time>.json`.

`start.sh` is safe to rerun: it reuses running processes and an existing channel. `stop.sh` keeps the chain; delete `.state/data` for a clean one.

## Cases

| # | Case |
| --- | --- |
| 0 | LNbits health through club-box |
| 1 | Membership purchase (N/A until club-box has a paid membership flow) |
| 2 | Court booking paid from node B; balances move by the invoice amount |
| 3a | Self-cancel without a refund invoice is refused and the booking is kept |
| 3b | Self-cancel with a node B invoice refunds the full amount |
| 3c | Staff refund to a node B invoice |
| 3d | A refund invoice larger than the payment is refused |
| 4a | A fixed-amount invoice cannot be underpaid |
| 4b | The invoice expires with the hold, so a late payment fails |
| 4c | A webhook with the wrong secret, or a "paid" body for an unpaid invoice, confirms nothing |
| 5a–5f | LNURL-auth (LUD-04/05) enrollment and door unlock with a simulated wallet: strict-QR parsing, unknown and revoked wallets denied, no sats move, per-domain linking keys |
| 6 | NFC NTAG 424 SUN tap: first tap opens, replay and UID-only taps are refused |
| 7 | Vending / allowance (N/A, not built yet) |
