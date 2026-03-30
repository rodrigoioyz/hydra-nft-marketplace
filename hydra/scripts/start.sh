#!/usr/bin/env bash
# Start the Hydra node for the NFT Marketplace
# Usage: ./start.sh [--detach]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/.env"

DETACH=false
[[ "${1:-}" == "--detach" ]] && DETACH=true

# ── Checks ───────────────────────────────────────────────────────────────────

if [ ! -f "${HYDRA_BIN}" ]; then
  echo "ERROR: hydra-node not found at ${HYDRA_BIN}"
  exit 1
fi

if [ ! -S "${NODE_SOCKET}" ]; then
  echo "ERROR: Cardano node socket not found at ${NODE_SOCKET}"
  echo "  Start the cardano-node first:"
  echo "    cd ~/workspace/hydra_test && make cardano-node-start"
  exit 1
fi

if [ ! -f "${HYDRA_SK}" ]; then
  echo "ERROR: Hydra signing key not found at ${HYDRA_SK}"
  exit 1
fi

mkdir -p "${PERSISTENCE_DIR}" "${LOGS_DIR}"

CARDANO_ADDR=$(cat "${CARDANO_ADDR_FILE}")
echo "Hydra NFT Marketplace — Node Startup"
echo "  Node ID:    ${NODE_ID}"
echo "  API:        http://${API_HOST}:${API_PORT}"
echo "  Network:    preprod (magic ${TESTNET_MAGIC})"
echo "  Address:    ${CARDANO_ADDR}"
echo "  Contestation period: ${CONTESTATION_PERIOD_SECS}"
echo ""

CMD="${HYDRA_BIN} \
  --node-id ${NODE_ID} \
  --api-port ${API_PORT} \
  --hydra-signing-key ${HYDRA_SK} \
  --cardano-signing-key ${CARDANO_SKEY} \
  --node-socket ${NODE_SOCKET} \
  --testnet-magic ${TESTNET_MAGIC} \
  --network preprod \
  --hydra-scripts-tx-id 476b37a7bf0c502f5eae596db43c418dec9e54a31567a71f34ed206a11e8f3da \
  --hydra-scripts-tx-id e353fb36b07f1bf452466c8b2a0de3ef15fb78e3ffaa7f6ad40ef00050df0937 \
  --hydra-scripts-tx-id 25a63794c62113d9194fbb3d0ac84e976d4903c97d126e55553345bca819d276 \
  --ledger-protocol-parameters ${PROTOCOL_PARAMS} \
  --contestation-period ${CONTESTATION_PERIOD_SECS} \
  --deposit-period ${DEPOSIT_PERIOD_SECS} \
  --persistence-dir ${PERSISTENCE_DIR}"

if [ "${DETACH}" = true ]; then
  if tmux has-session -t hydra-marketplace 2>/dev/null; then
    echo "ERROR: tmux session 'hydra-marketplace' already running."
    echo "  Stop it first: ./stop.sh"
    exit 1
  fi
  tmux new-session -d -s hydra-marketplace \
    "set -o pipefail; ${CMD} 2>&1 | tee ${LOGS_DIR}/hydra-node.log"
  echo "Started in tmux session: hydra-marketplace"
  echo "  Attach: tmux attach -t hydra-marketplace"
  echo "  Logs:   tail -f ${LOGS_DIR}/hydra-node.log"
else
  echo "Starting hydra-node (foreground)... Ctrl+C to stop."
  echo ""
  exec ${CMD} 2>&1 | tee "${LOGS_DIR}/hydra-node.log"
fi
