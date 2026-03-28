#!/usr/bin/env bash
# Stop the Hydra node for the NFT Marketplace

set -euo pipefail

if tmux has-session -t hydra-marketplace 2>/dev/null; then
  tmux kill-session -t hydra-marketplace
  echo "Stopped: tmux session 'hydra-marketplace'"
else
  pkill -INT -f "hydra-node.*marketplace-1" 2>/dev/null && echo "Stopped: hydra-node process" || echo "No running hydra-marketplace node found"
fi
