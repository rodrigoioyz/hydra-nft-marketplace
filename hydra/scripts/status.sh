#!/usr/bin/env bash
# Check status of the Hydra node and Head

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/.env"

API="http://${API_HOST}:${API_PORT}"

echo "=== Hydra NFT Marketplace — Node Status ==="
echo ""

# Node process
if tmux has-session -t hydra-marketplace 2>/dev/null; then
  echo "  Process:  RUNNING (tmux: hydra-marketplace)"
else
  echo "  Process:  STOPPED"
fi

# API health via WebSocket Greetings
echo ""
echo "=== Node Status (WebSocket Greetings) ==="
timeout 5 node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:4001');
ws.on('message', (data) => {
  const m = JSON.parse(data);
  if (m.tag === 'Greetings') {
    console.log('  headStatus:  ' + m.headStatus);
    console.log('  version:     ' + m.hydraNodeVersion);
    console.log('  contestation:' + m.env.contestationPeriod + 's');
    console.log('  network:     ' + (m.networkInfo.networkConnected ? 'connected' : 'disconnected'));
    ws.close(); process.exit(0);
  }
});
ws.on('error', e => { console.error('  WS error:', e.message); process.exit(1); });
" 2>/dev/null || echo "  API not reachable (is hydra-node running?)"

# Snapshot UTxO
echo ""
echo "=== Snapshot UTxO ==="
UTXO=$(curl -sf "${API}/snapshot/utxo" 2>/dev/null)
if [ -n "${UTXO}" ] && [ "${UTXO}" != "{}" ]; then
  COUNT=$(echo "${UTXO}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))")
  LOVELACE=$(echo "${UTXO}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
total = sum(v.get('value', {}).get('lovelace', 0) for v in d.values())
print(total)
")
  echo "  UTxOs:    ${COUNT}"
  echo "  Lovelace: ${LOVELACE} ($(echo "scale=2; ${LOVELACE}/1000000" | bc) ADA)"
else
  echo "  Head not open or no UTxOs"
fi

# Wallet balance
echo ""
echo "=== Wallet Balance (L1) ==="
ADDR=$(cat "${CARDANO_ADDR_FILE}")
echo "  Address: ${ADDR}"
CARDANO_NODE_SOCKET_PATH="${NODE_SOCKET}" "${CARDANO_CLI}" latest query utxo \
  --address "${ADDR}" \
  --testnet-magic "${TESTNET_MAGIC}" 2>/dev/null || echo "  (cardano-node not available)"
