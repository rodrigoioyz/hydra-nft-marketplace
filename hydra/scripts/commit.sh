#!/usr/bin/env bash
# Commit UTxOs into a Hydra Head (Initializing phase)
# Builds a blueprint tx, posts to /commit, signs and submits to L1
# Usage: ./commit.sh [lovelace_amount]  (default: 50000000 = 50 ADA)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/.env"

AMOUNT=${1:-50000000}
TMP=$(mktemp -d)
trap "rm -rf ${TMP}" EXIT

export CARDANO_NODE_SOCKET_PATH="${NODE_SOCKET}"
WALLET_ADDR=$(cat "${CARDANO_ADDR_FILE}")

echo "Committing ${AMOUNT} lovelace ($(echo "scale=2; ${AMOUNT}/1000000" | bc) ADA) to Head..."

# ── 1. Find a suitable UTxO ────────────────────────────────────────────────

"${CARDANO_CLI}" latest query utxo \
  --address "${WALLET_ADDR}" \
  --testnet-magic "${TESTNET_MAGIC}" \
  --out-file "${TMP}/utxos.json"

# Pick UTxO with enough lovelace
read UTXO_HASH UTXO_IX UTXO_LOVELACE <<< $(python3 -c "
import json, sys
utxos = json.load(open('${TMP}/utxos.json'))
best = None
for ref, out in utxos.items():
    l = out.get('value', {}).get('lovelace', 0)
    if l >= ${AMOUNT}:
        if best is None or l < best[2]:
            h, i = ref.split('#')
            best = (h, i, l)
if best is None:
    print('ERROR: no UTxO with enough funds', file=sys.stderr)
    sys.exit(1)
print(best[0], best[1], best[2])
")

echo "  Using UTxO: ${UTXO_HASH}#${UTXO_IX} (${UTXO_LOVELACE} lovelace)"

# ── 2. Build blueprint tx ──────────────────────────────────────────────────

"${CARDANO_CLI}" latest transaction build-raw \
  --tx-in "${UTXO_HASH}#${UTXO_IX}" \
  --tx-out "${WALLET_ADDR}+${UTXO_LOVELACE}" \
  --fee 0 \
  --out-file "${TMP}/blueprint.json"

# ── 3. Build commit body ───────────────────────────────────────────────────

python3 - "${UTXO_HASH}" "${UTXO_IX}" "${WALLET_ADDR}" "${UTXO_LOVELACE}" "${TMP}/blueprint.json" "${TMP}/commit-body.json" << 'PYEOF'
import json, sys
hash, ix, addr, lovelace, blueprint_path, out_path = sys.argv[1:]
blueprint = json.load(open(blueprint_path))
body = {
    "blueprintTx": blueprint,
    "utxo": {
        f"{hash}#{ix}": {
            "address": addr,
            "value": {"lovelace": int(lovelace)}
        }
    }
}
json.dump(body, open(out_path, 'w'))
print("Commit body built OK")
PYEOF

# ── 4. POST /commit → get draft tx ────────────────────────────────────────

HTTP_CODE=$(curl -sf -o "${TMP}/draft.json" -w "%{http_code}" \
  -X POST "http://${API_HOST}:${API_PORT}/commit" \
  -H 'Content-Type: application/json' \
  -d @"${TMP}/commit-body.json")

if [ "${HTTP_CODE}" != "200" ]; then
  echo "ERROR: /commit returned HTTP ${HTTP_CODE}"
  cat "${TMP}/draft.json"
  exit 1
fi

echo "  Draft commit tx received (txId: $(python3 -c "import json; print(json.load(open('${TMP}/draft.json'))['txId'])"))"

# ── 5. Sign ───────────────────────────────────────────────────────────────

"${CARDANO_CLI}" latest transaction sign \
  --tx-file "${TMP}/draft.json" \
  --signing-key-file "${CARDANO_SKEY}" \
  --testnet-magic "${TESTNET_MAGIC}" \
  --out-file "${TMP}/signed.json"

echo "  Signed OK"

# ── 6. Submit to L1 ───────────────────────────────────────────────────────

"${CARDANO_CLI}" latest transaction submit \
  --tx-file "${TMP}/signed.json" \
  --testnet-magic "${TESTNET_MAGIC}"

echo "  Submitted to L1"
echo ""
echo "Waiting for HeadIsOpen (up to 120s)..."
timeout 120 bash -c "
  tail -f '${LOGS_DIR}/hydra-node.log' |
  grep -m1 'HeadIsOpen'
" && echo "Head is OPEN with funds!" || echo "Still waiting — check: make logs"
