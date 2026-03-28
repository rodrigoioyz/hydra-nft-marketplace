# Hydra NFT Marketplace — root Makefile
# Usage: make <target>

SHELL := /bin/bash
.PHONY: help backend frontend e2e e2e-infra typecheck

##@ Development

backend: ## Start backend in dev mode (tsx watch)
	cd backend && npm run dev

frontend: ## Start frontend dev server (port 3001)
	cd frontend && npm run dev

##@ Testing

e2e: ## Run full E2E suite (requires running backend + open Hydra Head + E2E_POLICY_ID set)
	cd e2e && npm test

e2e-infra: ## Run only infrastructure checks (health, head, listings, admin stats)
	cd e2e && E2E_POLICY_ID= E2E_ASSET_NAME= npm test

typecheck: ## Typecheck all TypeScript packages
	@echo "==> backend" && cd backend  && npx tsc --noEmit
	@echo "==> frontend" && cd frontend && npx tsc --noEmit
	@echo "==> e2e"     && cd e2e      && npx tsc --noEmit
	@echo "All packages typecheck clean."

##@ Hydra Node

hydra-start: ## Start Hydra node in tmux
	cd hydra && make start

hydra-stop: ## Stop Hydra node
	cd hydra && make stop

hydra-status: ## Check Hydra node status
	cd hydra && make status

hydra-init: ## Initialize the Hydra Head
	cd hydra && make init

hydra-close: ## Close the Hydra Head
	cd hydra && make close

hydra-fanout: ## Fanout after contestation deadline
	cd hydra && make fanout

##@ Help

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
