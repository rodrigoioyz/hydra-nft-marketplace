#!/usr/bin/env bash
# Initialize the Hydra Head (T1.3)
# Usage: ./init.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/.env"

echo "Sending Init to Hydra Head..."
node "${SCRIPT_DIR}/hydra-ws-cmd.js" Init HeadIsInitializing 180
echo ""
echo "Head is Initializing. Now run: make commit"
