#!/usr/bin/env bash
# Fanout — distribute Head funds back to L1 after contestation deadline
# Usage: ./fanout.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/.env"

echo "Sending Fanout..."
node "${SCRIPT_DIR}/hydra-ws-cmd.js" Fanout ReadyToFanout 30 2>/dev/null || \
node "${SCRIPT_DIR}/hydra-ws-cmd.js" Fanout HeadIsFinalized 60
echo "Fanout complete."
