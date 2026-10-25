#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Daniel Solano and BitPadel contributors
# Stop the regtest stack started by start.sh. Data stays in .state/data; start.sh resumes it.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${REGTEST_STATE_DIR:-$HERE/.state}"
BIN="${REGTEST_BIN_DIR:-$STATE/bin}"
DATA="${REGTEST_DATA_DIR:-$STATE/data}"
LNCLI="$BIN/lnd-linux-amd64-v0.18.5-beta/lncli"
pkill -f "lnbits/.venv/bin/lnbits" 2>/dev/null; pkill -f "uv run --no-dev lnbits" 2>/dev/null
"$LNCLI" "--lnddir=$DATA/lnda" --network=regtest --rpcserver=127.0.0.1:10009 stop >/dev/null 2>&1
"$LNCLI" "--lnddir=$DATA/lndb" --network=regtest --rpcserver=127.0.0.1:10010 stop >/dev/null 2>&1
sleep 3
"$BIN/bitcoin-28.1/bin/bitcoin-cli" "-datadir=$DATA/btc" stop >/dev/null 2>&1
echo "regtest stack stopped (data kept in $DATA; rm -rf it for a clean chain)"
