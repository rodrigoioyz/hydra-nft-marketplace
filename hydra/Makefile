# Hydra NFT Marketplace — Hydra Node Management
# Usage: make <target>

SHELL := /bin/bash
.PHONY: help start stop restart status init logs snapshot check

SCRIPTS := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))scripts

##@ Node lifecycle

start: ## Start hydra-node in tmux (background)
	@bash $(SCRIPTS)/start.sh --detach

start-fg: ## Start hydra-node in foreground
	@bash $(SCRIPTS)/start.sh

stop: ## Stop hydra-node
	@bash $(SCRIPTS)/stop.sh

restart: stop start ## Restart hydra-node

##@ Head operations

init: ## Initialize the Hydra Head (sends Init, waits for HeadIsInitializing)
	@bash $(SCRIPTS)/init.sh

commit: ## Commit 50 ADA into the Head (blueprint pattern, signs + submits to L1)
	@bash $(SCRIPTS)/commit.sh

commit-amount: ## Commit custom amount: make commit-amount AMOUNT=100000000
	@bash $(SCRIPTS)/commit.sh $(AMOUNT)

close: ## Close the Hydra Head
	@node $(SCRIPTS)/hydra-ws-cmd.js Close HeadIsClosed 180

fanout: ## Fanout after contestation deadline
	@bash $(SCRIPTS)/fanout.sh

##@ Monitoring

status: ## Show node process, API health, UTxO snapshot, wallet balance
	@bash $(SCRIPTS)/status.sh

logs: ## Tail hydra-node logs
	@source $(SCRIPTS)/../config/.env && tail -f $${LOGS_DIR}/hydra-node.log

snapshot: ## Show current UTxO snapshot (raw JSON)
	@source $(SCRIPTS)/../config/.env && \
		curl -sf http://$${API_HOST}:$${API_PORT}/snapshot/utxo | python3 -m json.tool

##@ Checks

check: ## Verify all prerequisites are in place
	@echo "Checking prerequisites..."
	@source $(SCRIPTS)/../config/.env && \
		[ -f "$${HYDRA_BIN}" ]      && echo "  [OK] hydra-node binary"   || (echo "  [FAIL] hydra-node not found at $${HYDRA_BIN}" && exit 1)
	@source $(SCRIPTS)/../config/.env && \
		[ -S "$${NODE_SOCKET}" ]    && echo "  [OK] cardano-node socket"  || echo "  [WARN] cardano-node socket not found — run: cd ~/workspace/hydra_test && make cardano-node-start"
	@source $(SCRIPTS)/../config/.env && \
		[ -f "$${HYDRA_SK}" ]       && echo "  [OK] hydra signing key"    || (echo "  [FAIL] hydra.sk not found" && exit 1)
	@source $(SCRIPTS)/../config/.env && \
		[ -f "$${CARDANO_SKEY}" ]   && echo "  [OK] cardano signing key"  || (echo "  [FAIL] cardano.skey not found" && exit 1)
	@source $(SCRIPTS)/../config/.env && \
		[ -f "$${PROTOCOL_PARAMS}" ] && echo "  [OK] protocol-parameters" || (echo "  [FAIL] protocol-parameters.json not found" && exit 1)
	@source $(SCRIPTS)/../config/.env && \
		echo "  Wallet: $$(cat $${CARDANO_ADDR_FILE})"
	@echo ""
	@echo "All checks passed. Run 'make start' to launch the node."

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
