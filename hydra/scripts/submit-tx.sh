#!/usr/bin/env bash
# Submit a signed transaction to the Hydra Head (T1.4)
# Usage: ./submit-tx.sh <signed-tx-cbor-hex>
#
# Example (ADA transfer test):
#   CBOR=$(cat my-signed-tx.signed | jq -r '.cborHex')
#   ./submit-tx.sh "$CBOR"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/.env"

API="http://${API_HOST}:${API_PORT}"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <signed-tx-cbor-hex>"
  exit 1
fi

CBOR="${1}"

echo "Submitting transaction to Hydra Head at ${API}..."
PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'tag': 'NewTx',
  'transaction': {
    'cborHex': sys.argv[1],
    'description': '',
    'type': 'Tx BabbageEra'
  }
}))
" "${CBOR}")

RESPONSE=$(curl -sf -X POST "${API}" \
  -H 'Content-Type: application/json' \
  -d "${PAYLOAD}")

echo "Response: ${RESPONSE}"
echo ""
echo "Monitor for TxValid/TxInvalid:"
echo "  tail -f ${LOGS_DIR}/hydra-node.log | grep -E 'TxValid|TxInvalid'"
