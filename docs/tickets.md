# Hydra NFT Marketplace — Tickets (MVP Backlog)

## Overview

This document breaks the MVP into **epics and actionable tickets**.
Each ticket is:
- small
- testable
- independently executable

**Status legend:** ✅ Done · 🔧 In progress · ⬜ Pending

---

# EPIC 1 — Hydra Environment Setup

## Goal
Run a working Hydra Head locally and submit a basic transaction.

### ✅ T1.1 — Setup Hydra repo
- Clone hydra repository
- Install dependencies
- Verify build runs

### ✅ T1.2 — Run local devnet
- Start hydra nodes (2–3 participants)
- Confirm nodes are reachable

### ✅ T1.3 — Open Hydra Head
- Initialize head
- Commit ADA UTxOs
- Confirm head opens

### ✅ T1.4 — Submit basic transaction
- Build simple ADA transfer
- Submit via `NewTx`
- Confirm via WebSocket event

---

# EPIC 2 — Hydra Client Integration (Backend)

## Goal
Backend can communicate with Hydra reliably.

### ✅ T2.1 — WebSocket connection
- Connect to hydra-node WS
- Handle reconnect logic

### ✅ T2.2 — Event ingestion
- Parse incoming events
- Log raw events

### ✅ T2.3 — Snapshot UTxO fetch
- Query current UTxO
- Store in memory cache

### ✅ T2.4 — Submit transactions
- Implement `NewTx` call
- Handle success/failure

### ✅ T2.5 — Idempotency layer
- Add request IDs
- Prevent duplicate submissions

---

# EPIC 3 — Database Setup

## Goal
Persist marketplace state.

### ✅ T3.1 — Setup PostgreSQL
- Initialize DB
- Configure connection

### ✅ T3.2 — Create schema
- listings
- sales
- head_sessions
- hydra_events
- tx_submissions

### ✅ T3.3 — Event persistence
- Store all Hydra events

### ✅ T3.4 — Projection layer
- Map events → listings/sales updates

---

# EPIC 4 — Transaction Builder

## Goal
Construct valid Cardano transactions for marketplace actions.

### ✅ T4.1 — Setup tx builder module
- Integrate cardano-cli (cardano serialization via CLI, not Lucid)

### ✅ T4.2 — Build transfer tx
- ADA transfer
- NFT transfer

### ✅ T4.3 — Build buy transaction
- Consume listing UTxO
- Pay seller
- Transfer NFT

### ✅ T4.4 — Build cancel transaction
- Return NFT to seller

### ✅ T4.5 — Validation checks
- Ensure correct inputs/outputs
- Prevent malformed txs

---

# EPIC 5 — Listings Backend

## Goal
Manage NFT listings.

### ✅ T5.1 — Create listing endpoint
- POST /listings + POST /listings/:id/escrow + POST /listings/:id/escrow-confirm

### ✅ T5.2 — Validate NFT ownership
- Check wallet assets (via Hydra UTxO snapshot)

### ✅ T5.3 — Store listing
- Save in DB with draft → active state machine

### ✅ T5.4 — Prevent duplicate listings
- Enforce uniqueness (delete draft on re-list)

### ✅ T5.5 — Get listings
- GET /listings with displayName (hex asset_name → UTF-8)

### ✅ T5.6 — Get listing by ID
- GET /listings/:id

---

# EPIC 6 — Buy Flow Backend

## Goal
Execute NFT purchase inside Hydra.

### ✅ T6.1 — Buy endpoint
- POST /listings/:id/buy

### ✅ T6.2 — Validate listing state
- Ensure active and unsold

### ✅ T6.3 — Fetch latest UTxO
- From Hydra snapshot cache

### ✅ T6.4 — Build buy tx
- cardano-cli build-raw, sign by operator, submit to Hydra

### ✅ T6.5 — Submit to Hydra
- Call `NewTx`

### ✅ T6.6 — Handle confirmation
- Update listing → sold, insert sale record
- With snapshot fallback (see BUG-003)

---

# EPIC 7 — Cancel Flow Backend

## Goal
Allow seller to cancel listings.

### ✅ T7.1 — Cancel endpoint
- POST /listings/:id/cancel

### ✅ T7.2 — Validate seller
- Match wallet address

### ✅ T7.3 — Build cancel tx

### ✅ T7.4 — Submit and confirm

### ✅ T7.5 — Update listing status

---

# EPIC 8 — Aiken Smart Contracts

## Goal
Implement escrow validation.

### ✅ T8.1 — Setup Aiken project

### ✅ T8.2 — Listing datum
- seller, policy_id, asset_name, price (lovelace)

### ✅ T8.3 — Redeemer types
- Buy, Cancel

### ✅ T8.4 — Validator logic
- Enforce correct payout to seller
- Enforce correct asset transfer to buyer
- Enforce price match with datum

### ✅ T8.5 — Contract tests
- Valid buy, invalid price, unauthorized cancel

### ✅ T8.6 — Compile to Plutus
- Deployed to preprod, script address confirmed

---

# EPIC 9 — Frontend (Next.js)

## Goal
User interface for marketplace.

### ✅ T9.1 — Setup project
- Next.js + TailwindCSS

### ✅ T9.2 — Wallet connection
- CIP-30 via Eternl/Nami (preprod)

### ✅ T9.3 — Listings page
- Display all listings with displayName (decoded from hex)

### ✅ T9.4 — Listing detail page

### ✅ T9.5 — Sell page
- Create listing form + escrow signing flow (SellForm.tsx)

### ✅ T9.6 — Buy button flow
- Buy modal + tx signing + confirmation

### ✅ T9.7 — Portfolio page
- L1 UTxOs + Head UTxOs displayed
- "Depositar al marketplace" button for token UTxOs (incremental commit flow)
- "Retirar" button for in-Head UTxOs (decommit flow)
- SSE-driven auto-refresh on CommitFinalized / DecommitFinalized
- "En tránsito" banner for pending deposits

### ✅ T9.8 — Head status UI
- Shows Head open/closed state

---

# EPIC 10 — State Sync Engine

## Goal
Keep DB aligned with Hydra state.

### ✅ T10.1 — Event processor
- Consume Hydra events (TxValid, TxInvalid, SnapshotConfirmed)

### ✅ T10.2 — Update projections
- Listings, Sales updated via eventStore.ts

### ✅ T10.3 — Reconciliation job
- Implemented in `backend/src/sync/stateRecovery.ts` → `reconcileListings()`
- On backend restart: fetches Head snapshot → promotes pending tx_submissions found in snapshot → marks active listings with missing escrow UTxO as failed
- Called from `index.ts` on `event:Greetings` when Head is open

---

# EPIC 15 — UX Overhaul (Hydra Invisible)

## Goal
Users trade inside the Head without knowing it exists.

### ✅ T15.1 — Decouple SellForm from Head lifecycle
- Removed Commit / Collect / Split ADA buttons
- Seller flow: select token → price → sign escrow → done

### ✅ T15.2 — BuySection receipt modal
- Spanish text, 3-step progress indicator, post-purchase receipt with txId

### ✅ T15.3 — SSE real-time listings (replace polling)
- ListingsGrid client component with EventSource
- Refreshes on TxValid / SnapshotConfirmed
- Removed revalidate: 5 from page.tsx

### ✅ T15.4 — KYC auto-update via SSE
- KycForm subscribes to /api/events
- Auto-updates when FarmerApproved fires for this address

### ✅ T15.5 — Portfolio page with Deposit/Withdraw
- L1 balance (Blockfrost) + Head balance (snapshot)
- "Depositar al marketplace" → incremental commit (v1.3.0)
- "Retirar" → decommit
- Pending state banner while commit processes

### ✅ T15.6 — Escrow recovery without hardcoding
- SellForm dynamically queries GET /listings/my-escrows/:address
- Cancel button per listing, no hardcoded CBOR

### ✅ T15.7 — Dashboard de productor
- /dashboard page: stats grid, active listings, recent sales, marketplace badge
- GET /api/farmers/stats/:address backend endpoint
- Quick actions: publish, portfolio, browse

### ✅ T15.8 — Toast notification system
- ToastProvider component with SSE subscription
- CommitFinalized, DecommitFinalized, FarmerApproved, HeadIsClosed, HeadIsOpen, hydra:disconnected
- Auto-dismiss 5s, bottom-right position, fade-in animation

---

# EPIC 16 — Hydra v1.3.0 Upgrade

### ✅ T16.1 — Binary upgrade
- hydra-node 1.2.0 → 1.3.0 (7ccf541)
- Backup of old binary preserved

### ✅ T16.2 — Script TX IDs updated
- hydra/scripts/start.sh: 3 preprod TX IDs updated to v1.3.0 values

### ✅ T16.3 — New event types added
- HydraEventTag: CommitRecorded, CommitApproved, CommitFinalized, Decommit* variants
- RELAY_TAGS in events.ts updated to match

### ⬜ T16.4 — Head re-initialization with v1.3.0 scripts
- Close current Head → Fanout → Init → classic commit → Collect
- Verify incremental commit works (CommitRecorded emitted)

---

# EPIC 11 — Admin & Observability

## Goal
Visibility into system health.

### ✅ T11.1 — Logging system
- Console logging throughout HydraClient + endpoints

### ✅ T11.2 — Admin endpoints
- GET /admin/farmers/pending, POST /admin/farmers/:id/approve, reject
- POST /admin/head/close, /admin/head/fanout
- SSE broadcast on FarmerApproved

### ✅ T11.3 — Head status dashboard
- /api/head/status endpoint + frontend banner

### ✅ T11.4 — Failed tx tracking
- `tx_submissions` table tracks all Hydra tx submissions with status (pending → confirmed/failed)
- `eventStore.ts` handles `TxInvalid`: updates submission to failed, rolls back listing/sale status
- BUG-001 fix (top-level `transactionId`) ensures txId matching works correctly

---

# EPIC 12 — End-to-End Testing

## Goal
Validate full MVP flow.

### 🔧 T12.1 — List NFT test
- Manual: Soja pepito, Lentejas pepito listed and active on preprod

### 🔧 T12.2 — Buy NFT test
- Manual: buy tx submitted and confirmed in Head (Hydra snapshot)
- Automated e2e: pending

### ✅ T12.3 — Cancel listing test
- Automated e2e test in `e2e/test.ts` → `testListAndCancelFlow()`
- Flow: create listing → escrow-confirm → cancel-tx → sign → cancel → verify status = cancelled
- Requires `E2E_POLICY_ID` + `E2E_ASSET_NAME` env vars

### ⬜ T12.4 — Hydra restart recovery test
- Manual only: stop backend → restart → verify `reconcileListings` promotes pending txs
- Automated test not feasible without live Hydra node in CI

### ⬜ T12.5 — Head close + fanout test
- Manual only: requires a running Head; use `POST /admin/head/close` → wait contestation deadline → `POST /admin/head/fanout`
- Dependent on T16.4 completion (Head re-init with v1.3.0 scripts)

---

# Execution Order (Critical Path)

1. EPIC 1 — Hydra setup
2. EPIC 2 — Hydra client
3. EPIC 3 — Database         ← moved up: listings and buy flow depend on it
4. EPIC 4 — Tx builder
5. EPIC 5 — Listings         ← must exist before buy flow
6. EPIC 6 — Buy flow
7. EPIC 10 — State sync
8. EPIC 7 — Cancel flow
9. EPIC 8 — Aiken contracts
10. EPIC 9 — Frontend
11. EPIC 11 — Admin
12. EPIC 12 — Testing

---

# Definition of Ready (per ticket)

- Clear input/output
- No dependency ambiguity
- Testable result

---

# Definition of Done (per ticket)

- Code implemented
- Tested locally
- No breaking errors
- Logged and observable

---

# MVP Success Criteria

- NFT listed ✅
- NFT purchased inside Hydra ✅ (confirmed in snapshot)
- Sale reflected in UI 🔧 (confirmed in DB; UI needs refresh after buy)
- No double-spend ✅ (Aiken validator + Hydra UTxO locking)
- Head lifecycle demonstrable ✅ (Head open on preprod, UTxOs committed)

---

# Bug Log

## BUG-001 — `awaitTxConfirmation` always times out (FIXED)

**Root cause:** `TxValidEvent` type defined `transaction.id` locally, but Hydra v1.2.0 actually sends `transactionId` as a **top-level field** with no `transaction` object in the `TxValid` event. The check `event.transaction?.id === txId` always evaluated to `undefined === txId` → always `false` → always 30s timeout.

**Verified against:** official Hydra v1.2.0 OpenAPI schema (`hydra-node/json-schemas/api.yaml`).

**Fix:** Updated `types/hydra.ts`, `hydra/client.ts`, and `db/eventStore.ts`:
- `TxValidEvent.transaction.id` → `TxValidEvent.transactionId`
- `TxInvalidEvent.transaction.id` → `TxInvalidEvent.transaction.txId?` (optional, per schema)
- `awaitTxConfirmation` now resolves immediately on match instead of timing out every time

**Files changed:** `backend/src/types/hydra.ts`, `backend/src/hydra/client.ts`, `backend/src/db/eventStore.ts`

---

## BUG-002 — `insufficient_funds` on buy (FIXED)

**Root cause:** Operator's UTxO in Head (20 ADA) was less than listing price (25 ADA). Listing price is baked into the on-chain datum; cannot be lowered in DB without rebuilding the escrow tx.

**Fix:** Merged two 20 ADA UTxOs inside the Head into one 39.8 ADA UTxO using a raw Hydra transaction. Required iterating fee values (0 → 165413 → 165589) because tx size changes as the fee field grows.

---

## BUG-003 — escrow-confirm and buy-confirm 502 after snapshot fallback (FIXED)

**Root cause:** `awaitTxConfirmation` always timed out (BUG-001), causing escrow-confirm and buy-confirm endpoints to return 502 even when the tx was successfully confirmed in the Hydra snapshot.

**Fix (interim, before BUG-001 fix):** Added snapshot-polling fallback to both endpoints:
1. Try `awaitTxConfirmation` with 60s timeout
2. On timeout, poll `hydra.getUtxos()` every 2s for 15s looking for outputs from the tx
3. If found in snapshot → treat as confirmed, continue

This fallback remains as defense-in-depth even after BUG-001 is fixed.

**Files changed:** `backend/src/api/listings.ts`

---

## BUG-004 — Token name displayed as policy ID in marketplace UI (FIXED)

**Root cause:** `asset_name` stored in DB as hex (e.g. `536f6a612070657069746f`). Frontend was displaying the raw hex instead of the decoded name.

**Fix:** Added `hexToUtf8` helper in `listings.ts` and `displayName` field to `toApiListing`. Returns decoded UTF-8 string or `null` if binary. Frontend consumes `displayName` to show human-readable names.

**Files changed:** `backend/src/api/listings.ts`

---

## BUG-005 — `required_signers` missing from escrow tx (FIXED)

**Root cause:** `buildEscrowTxUnsigned` in `cli.ts` did not include `--required-signer-hash` for the seller's verification key hash. Some CIP-30 wallets use this field to decide whether to attach their signature without requiring the UTxO to be on L1 (since Hydra UTxOs are not visible on L1).

**Fix:** Added `--required-signer-hash ${opts.sellerVkh}` to the `cardano-cli transaction build-raw` call.

**Files changed:** `backend/src/tx/cli.ts`

