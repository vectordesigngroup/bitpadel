#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Daniel Solano and BitPadel contributors
#
# Start a throwaway REGTEST Lightning stack for club-box:
#   bitcoind (regtest) + LND node A (LNbits funding source) + LND node B (player wallet)
#   + LNbits on node A, with a 5,000,000-sat channel B -> A.
# Regtest coins are free and worthless. This script refuses to run on any other network.
# Writes .state/state.json for e2e.ts. Rerunning reuses an existing stack.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${REGTEST_STATE_DIR:-$HERE/.state}"
BIN="${REGTEST_BIN_DIR:-$STATE/bin}"
DATA="${REGTEST_DATA_DIR:-$STATE/data}"
mkdir -p "$BIN" "$DATA"
for tool in curl jq git sha256sum; do command -v "$tool" >/dev/null || { echo "$tool is required"; exit 1; }; done

BTC_VER=28.1
LND_VER=v0.18.5-beta
NODE_VER=v22.21.0
LNBITS_TAG=v1.6.2
# SHA-256 of the official downloads, recorded when this harness was written.
BTC_SHA=07f77afd326639145b9ba9562912b2ad2ccec47b8a305bd075b4f4cb127b7ed7
LND_SHA=ffffa63b28a031a330eae4db234ada1bd27003059757c1a0d3aeb0d8d7351c4f
NODE_SHA=71a04f4b9144870c9407b8019fe912514229e50246bc706862eded3ac8e9025d

fetch() { # url file sha
  if [ ! -f "$BIN/$2" ]; then curl -fsSL "$1" -o "$BIN/$2.part" && mv "$BIN/$2.part" "$BIN/$2"; fi
  echo "$3  $BIN/$2" | sha256sum -c --quiet -
}

fetch "https://bitcoincore.org/bin/bitcoin-core-$BTC_VER/bitcoin-$BTC_VER-x86_64-linux-gnu.tar.gz" "bitcoin-$BTC_VER-x86_64-linux-gnu.tar.gz" "$BTC_SHA"
fetch "https://github.com/lightningnetwork/lnd/releases/download/$LND_VER/lnd-linux-amd64-$LND_VER.tar.gz" "lnd-linux-amd64-$LND_VER.tar.gz" "$LND_SHA"
fetch "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz" "node-$NODE_VER-linux-x64.tar.xz" "$NODE_SHA"
[ -d "$BIN/bitcoin-$BTC_VER" ] || tar -xzf "$BIN/bitcoin-$BTC_VER-x86_64-linux-gnu.tar.gz" -C "$BIN"
[ -d "$BIN/lnd-linux-amd64-$LND_VER" ] || tar -xzf "$BIN/lnd-linux-amd64-$LND_VER.tar.gz" -C "$BIN"
[ -d "$BIN/node-$NODE_VER-linux-x64" ] || tar -xJf "$BIN/node-$NODE_VER-linux-x64.tar.xz" -C "$BIN"
if [ ! -d "$BIN/lnbits/.venv" ]; then
  command -v uv >/dev/null || { echo "uv is required to install LNbits (https://docs.astral.sh/uv/)"; exit 1; }
  [ -d "$BIN/lnbits" ] || git clone -q --depth 1 --branch "$LNBITS_TAG" https://github.com/lnbits/lnbits "$BIN/lnbits"
  (cd "$BIN/lnbits" && uv sync --python 3.12 --no-dev >"$DATA/lnbits-install.log" 2>&1)
fi

BCLI=("$BIN/bitcoin-$BTC_VER/bin/bitcoin-cli" "-datadir=$DATA/btc")
LNCLI="$BIN/lnd-linux-amd64-$LND_VER/lncli"
LNA=("$LNCLI" "--lnddir=$DATA/lnda" --network=regtest --rpcserver=127.0.0.1:10009)
LNB=("$LNCLI" "--lnddir=$DATA/lndb" --network=regtest --rpcserver=127.0.0.1:10010)
wait_for() { for _ in $(seq 1 90); do if "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done; echo "timed out: $*"; exit 1; }

# --- bitcoind ---------------------------------------------------------------
mkdir -p "$DATA/btc"
cat >"$DATA/btc/bitcoin.conf" <<CONF
regtest=1
server=1
txindex=1
fallbackfee=0.0002
[regtest]
rpcuser=bp
rpcpassword=bp
rpcport=18443
zmqpubrawblock=tcp://127.0.0.1:28332
zmqpubrawtx=tcp://127.0.0.1:28333
CONF
"${BCLI[@]}" getblockchaininfo >/dev/null 2>&1 || "$BIN/bitcoin-$BTC_VER/bin/bitcoind" "-datadir=$DATA/btc" -daemon </dev/null >/dev/null 2>&1
wait_for "${BCLI[@]}" getblockchaininfo
[ "$("${BCLI[@]}" getblockchaininfo | jq -r .chain)" = regtest ] || { echo "not regtest, refusing"; exit 1; }
"${BCLI[@]}" loadwallet miner >/dev/null 2>&1 || "${BCLI[@]}" createwallet miner >/dev/null 2>&1 || true
MINE() { "${BCLI[@]}" -rpcwallet=miner generatetoaddress "$1" "$("${BCLI[@]}" -rpcwallet=miner getnewaddress)" >/dev/null; }
[ "$("${BCLI[@]}" getblockcount)" -ge 101 ] || MINE 101

# --- two LND nodes ----------------------------------------------------------
start_lnd() { # dir alias p2p rpc rest
  mkdir -p "$DATA/$1"
  cat >"$DATA/$1/lnd.conf" <<CONF
[Application Options]
alias=$2
listen=127.0.0.1:$3
rpclisten=127.0.0.1:$4
restlisten=127.0.0.1:$5
noseedbackup=true
[Bitcoin]
bitcoin.active=true
bitcoin.regtest=true
bitcoin.node=bitcoind
[Bitcoind]
bitcoind.rpchost=127.0.0.1:18443
bitcoind.rpcuser=bp
bitcoind.rpcpass=bp
bitcoind.zmqpubrawblock=tcp://127.0.0.1:28332
bitcoind.zmqpubrawtx=tcp://127.0.0.1:28333
CONF
  "$LNCLI" "--lnddir=$DATA/$1" --network=regtest "--rpcserver=127.0.0.1:$4" getinfo >/dev/null 2>&1 ||
    nohup "$BIN/lnd-linux-amd64-$LND_VER/lnd" "--lnddir=$DATA/$1" </dev/null >"$DATA/$1/out.log" 2>&1 &
}
start_lnd lnda node-a 9735 10009 8081
start_lnd lndb node-b 9736 10010 8082
wait_for "${LNA[@]}" getinfo
wait_for "${LNB[@]}" getinfo
PUBA=$("${LNA[@]}" getinfo | jq -r .identity_pubkey)
[ "$("${LNB[@]}" getinfo | jq -r '.chains[0].network')" = regtest ] || { echo "node B is not on regtest, refusing"; exit 1; }

# --- fund B and open B -> A -------------------------------------------------
b_active() { [ "$("${LNB[@]}" listchannels | jq '[.channels[] | select(.active)] | length')" -gt 0 ]; }
b_funded() { [ "$("${LNB[@]}" walletbalance | jq -r .confirmed_balance)" -ge 6000000 ]; }
synced() { [ "$("$@" getinfo | jq -r .synced_to_chain)" = true ]; }
if ! b_active; then
  if ! b_funded; then
    ADDR=$("${LNB[@]}" newaddress p2wkh | jq -r .address)
    "${BCLI[@]}" -rpcwallet=miner sendtoaddress "$ADDR" 5 >/dev/null
    MINE 6
    wait_for b_funded
  fi
  wait_for synced "${LNA[@]}"
  wait_for synced "${LNB[@]}"
  "${LNB[@]}" connect "$PUBA@127.0.0.1:9735" >/dev/null 2>&1 || true
  "${LNB[@]}" openchannel --node_key "$PUBA" --local_amt 5000000 >/dev/null
  MINE 6
  wait_for b_active
fi

# --- LNbits on node A -------------------------------------------------------
mkdir -p "$DATA/lnbits"
cat >"$DATA/lnbits/env" <<CONF
HOST=127.0.0.1
PORT=5000
LNBITS_DATA_FOLDER=$DATA/lnbits
LNBITS_ADMIN_UI=false
LNBITS_BACKEND_WALLET_CLASS=LndRestWallet
LND_REST_ENDPOINT=https://127.0.0.1:8081/
LND_REST_CERT=$DATA/lnda/tls.cert
LND_REST_MACAROON=$DATA/lnda/data/chain/bitcoin/regtest/admin.macaroon
LNBITS_CALLBACK_URL_RULES='["https?://.*"]'
LNBITS_CALLBACK_ALLOW_PRIVATE_IPS=true
LNBITS_LNURL_ALLOW_PRIVATE_IPS=true
LNBITS_ALLOW_NEW_ACCOUNTS=true
CONF
if ! curl -fs http://127.0.0.1:5000/api/v1/health >/dev/null 2>&1; then
  (cd "$BIN/lnbits" && set -a && . "$DATA/lnbits/env" && set +a && nohup uv run --no-dev lnbits </dev/null >"$DATA/lnbits/out.log" 2>&1 &)
fi
wait_for curl -fs http://127.0.0.1:5000/api/v1/health
if [ ! -f "$DATA/lnbits/wallet.json" ]; then
  curl -fs -X POST http://127.0.0.1:5000/api/v1/account -H 'content-type: application/json' \
    -d '{"name":"club-box regtest"}' >"$DATA/lnbits/wallet.json"
fi
INKEY=$(jq -r .inkey "$DATA/lnbits/wallet.json")
ADMINKEY=$(jq -r .adminkey "$DATA/lnbits/wallet.json")

# Seed the club wallet with a 100,000-sat float paid by node B. Without it the club
# cannot refund: LNbits keeps a routing-fee reserve, and node A must hold more than
# its channel reserve (1% of capacity) before it can send anything back.
if [ "$(curl -fs http://127.0.0.1:5000/api/v1/wallet -H "x-api-key: $INKEY" | jq -r .balance)" = 0 ]; then
  FLOAT=$(curl -fs -X POST http://127.0.0.1:5000/api/v1/payments -H "x-api-key: $INKEY" \
    -H 'content-type: application/json' -d '{"out":false,"amount":100000,"memo":"regtest club float"}' | jq -r .bolt11)
  "${LNB[@]}" payinvoice --force "$FLOAT" >/dev/null
fi

cat >"$STATE/state.json" <<JSON
{"lncli":"$LNCLI",
"lndA":["--lnddir=$DATA/lnda","--network=regtest","--rpcserver=127.0.0.1:10009"],
"lndB":["--lnddir=$DATA/lndb","--network=regtest","--rpcserver=127.0.0.1:10010"],
"lnbitsUrl":"http://127.0.0.1:5000","invoiceKey":"$INKEY","adminKey":"$ADMINKEY",
"bitcoinCli":["${BCLI[0]}","${BCLI[1]}"],"nodeBin":"$BIN/node-$NODE_VER-linux-x64/bin"}
JSON
echo "regtest stack up. Run the checks with:"
echo "  PATH=$BIN/node-$NODE_VER-linux-x64/bin:\$PATH npx tsx scripts/regtest/e2e.ts"
