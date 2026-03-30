# Hydra NFT Marketplace — Development Report

**Last updated:** 2026-03-30
**Stack:** Aiken v1.1.19 · cardano-cli 10.x · Hydra v1.3.0 · TypeScript/Express · PostgreSQL · Next.js 14
**Network:** Cardano preprod (testnet-magic 1)

---

## 1. What Was Built

A fixed-price marketplace for agricultural crop tokens where all trades execute **inside a Hydra Head** (Cardano Layer 2). Farmers register with a privacy-preserving KYC (FarmerPass NFT on L1), mint fungible crop tokens on L1, commit them into the Head, and trade inside the Head.

| Epic | Description | Status |
|------|-------------|--------|
| 4  | Hydra WebSocket client + cardano-cli builder | ✅ |
| 5  | Listings backend (create, escrow-confirm, DB) | ✅ |
| 6  | Buy flow (operator-signed, collateral selection) | ✅ fixed |
| 7  | Cancel flow (seller-signed, 2-step) | ✅ |
| 8  | Aiken listing validator (14 tests) | ✅ |
| 9  | Next.js 14 frontend (browse, sell, buy, cancel) | ✅ |
| 10 | State sync engine (SnapshotConfirmed catch-up, session recovery) | ✅ |
| 11 | Admin & observability (health, stats, request logging) | ✅ |
| 12 | E2E test suite (TypeScript, cardano-cli signing) | ✅ |
| 13 | Farmer identity system (FarmerPass + CropTokens on L1) | ✅ |
| 14 | Commit flow (classic commit + collect + ADA split) | ✅ fixed |
| 15 | UX overhaul (invisible Head, SSE real-time, portfolio, dashboard, toasts) | ✅ |
| 16 | Incremental commit (deposit while Head Open) | ✅ fixed in Hydra v1.3.0 |

---

## 2. Repository Layout

```
hydra-nft-marketplace/
├── backend/src/
│   ├── api/
│   │   ├── head.ts             # GET status, POST init/collect/split-ada
│   │   ├── listings.ts         # full listing lifecycle
│   │   ├── farmers.ts          # KYC + CropToken + build-commit-tx
│   │   ├── health.ts
│   │   ├── admin.ts
│   │   └── middleware.ts
│   ├── hydra/client.ts         # WS client + initHead/collect/awaitHeadOpen
│   ├── tx/cli.ts               # cardano-cli builder (escrow, buy, cancel, transfer)
│   ├── tx/l1mint.ts            # L1 mint helpers + UTxO query
│   ├── types/hydra.ts          # HydraCommand union (Init/Collect/Close/Fanout/NewTx)
│   └── config.ts
├── contracts/validators/
│   ├── listing.ak              # spend: Buy (quantity>=1) | Cancel
│   ├── farmer_pass.ak          # operator-controlled mint policy
│   └── crop_token.ak           # farmer+farmerpass mint policy
├── frontend/
│   ├── app/sell/SellForm.tsx   # full commit+collect+list flow
│   ├── context/WalletContext.tsx  # signTx(cbor, partialSign?)
│   └── lib/wallet.ts           # signTransaction(wallet, cbor, partialSign)
└── hydra/
    ├── keys/
    └── scripts/
```

---

## 3. Architecture Decisions

### 3.1 Buyer-funded escrow model (REVISED 2026-03-29)

**Original (broken) design:** The escrow UTxO was supposed to hold NFT + priceLovelace + minADA. The buyer paid nothing — the operator built the buy tx using only the escrow UTxO.

**Problem:** The change calculation `escrowLovelace - priceLovelace - minLovelace - fee` is **always negative** for any real price, because the escrow only contains minADA (~2 ADA), not the price (e.g. 40 ADA).

**Fixed design (buyer-funded):** The buy tx requires **two inputs**: the escrow UTxO (holds NFT + minADA) and a buyer/operator pure-ADA UTxO that funds the seller payment.

```
Inputs:
  escrow UTxO  (NFT + minADA)
  buyer input  (buyerLovelace ≥ priceLovelace)

Outputs:
  seller       (priceLovelace)
  buyer        (NFT + minADA)
  change       (escrowLovelace + buyerLovelace - priceLovelace - minLovelace - fee)
```

The listing validator (`listing.ak`) only checks outputs — it does **not** require the buyer's signature. The operator uses their own ADA UTxO in the Head as the buyer input, builds and signs server-side, and the NFT goes to the `buyerAddress` specified in the redeemer.

This requires **2 pure-ADA UTxOs** in the Head (one for buyer input, one for collateral). Use `POST /api/head/split-ada` immediately after the Head opens to create the second UTxO.

### 3.2 Classic commit (not incremental deposit)

**Incremental deposit (Hydra 1.2.0):** `POST /commit` while Head is Open → deposit tx on L1 → Hydra emits `CommitRecorded` → Hydra processes increment. **THIS IS BROKEN in our setup.** The deposit confirms on L1 but Hydra never emits `CommitRecorded`. `GET /commits` always returns `[]`. Root cause unclear (possibly missing `--hydra-scripts-tx-id` flag, or incremental commits disabled).

**Classic commit (what we use):** Commit UTxOs while Head is in `Initializing` state (before `Collect`). All committed UTxOs are available when the Head opens. Reliable and tested.

**Flow:**
1. `POST /api/head/init` (if Head is Idle) → Hydra sends Init → `HeadIsInitializing`
2. `POST /crops/build-commit-tx` — combined commit body with pepito's CropToken + operator's ADA → operator signs server-side → returns partially-signed CBOR
3. Farmer signs in browser (`signTx(cbor, true)` — partialSign=true) → submits to L1 via `POST /crops/submit-commit-tx`
4. `POST /api/head/collect` → Hydra sends Collect → waits for `HeadIsOpen` → records session in DB
5. `POST /api/head/split-ada` → splits operator's ADA into 2 UTxOs (collateral + buyer input)

### 3.3 Combined commit (multi-sig)

The classic commit includes **two UTxOs** owned by different parties:
- Farmer's CropToken UTxO (owned by pepito, on L1)
- Operator's pure-ADA UTxO (owned by operator, on L1)

Hydra's `POST /commit` returns one unsigned tx CBOR that spends both. Since each UTxO has a different owner:
1. Backend signs with operator's skey server-side (`cardano-cli transaction sign`)
2. Returns the operator-signed CBOR to the frontend
3. Frontend wallet calls `signTx(operatorSignedCbor, true)` — adds farmer's witness without removing operator's
4. Submits fully-signed CBOR to L1 via `POST /crops/submit-commit-tx`

CIP-30 wallets support `partialSign=true` (second arg to `wallet.signTx()`) for exactly this case.

### 3.4 FarmerPass NFT (L1 identity token)

FarmerPass is an L1 NFT minted under a policy controlled by the operator:
- **Token name** = farmer's payment key hash (28 bytes) — enforces one pass per wallet
- `identity_hash` = sha256("nombre:documento") — computed client-side; PII never stored anywhere
- Lives on L1 so it survives Hydra Head restarts

### 3.5 CropToken (fungible, minted on L1, traded on L2)

- Fungible (not NFT) — e.g. 1000 units of "Maiz pepito"
- Minted on L1 using `buildCropMintTxUnsigned` (farmer signs in browser)
- Committed into the Head for trading via combined commit
- Listing validator uses `quantity >= 1` (not `== 1`) for fungible support
- **Escrow locks full token quantity** (not just 1 unit) to avoid unbalanced tx when input has 1000 tokens

### 3.6 Two-step seller flows

List and Cancel require the seller's signature but the backend never holds the seller's key:
1. Backend builds unsigned tx CBOR → returns to frontend
2. Seller signs in browser wallet (CIP-30 `signTx`)
3. Frontend posts signed CBOR back → backend submits to Hydra

---

## 4. Aiken Contracts

### 4.1 `listing.ak` — spend validator

```aiken
Buy { buyer } ->
  seller_paid(tx.outputs, datum.seller, datum.price) &&
  buyer_receives_nft(tx.outputs, buyer, datum.policy_id, datum.asset_name)
Cancel ->
  seller_signed(tx.extra_signatories, datum.seller) &&
  nft_returned(tx.outputs, datum.seller, datum.policy_id, datum.asset_name)
```

Key: `Buy` does NOT require buyer signature — only output checks. `quantity >= 1` (not `== 1`).

### 4.2 `farmer_pass.ak` — minting policy

Operator controls minting. Token name = farmer PKH. Exports `has_farmer_pass()`.

### 4.3 `crop_token.ak` — minting policy

```aiken
MintCrop { farmer_pkh } ->
  list.has(tx.extra_signatories, farmer_pkh) &&
  has_farmer_pass(tx, farmer_pass_policy_id, farmer_pkh)
BurnCrop { owner_pkh } ->
  list.has(tx.extra_signatories, owner_pkh) ||
  list.has(tx.extra_signatories, operator_pkh)
```

### 4.4 Test suite (26 tests, all pass)

```bash
cd contracts
aiken check   # 26/26
aiken build   # → plutus.json
```

### 4.5 Compiled output (preprod)

- **Listing script hash:** `8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc`
- **Listing address:** `addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm`
- FarmerPass + CropToken policies are in `contracts/plutus.json`, parameterised at runtime from `getL1Scripts()`

---

## 5. Bugs Encountered and Fixed

### 5.1 `buildBuyTx` — missing buyer input (CRITICAL)

**Symptom:** `change = escrowLovelace - priceLovelace - minLovelace - fee` always negative (e.g. 2 ADA - 40 ADA - 2 ADA = -40 ADA). cardano-cli rejects with unbalanced tx.

**Root cause:** The buy tx was designed with a "seller-funded escrow" model — escrow holds price+NFT. This was never actually implemented.

**Fix:** Added `buyerInputRef` and `buyerInputLovelace` to `buildBuyTx`. The buy handler (`POST /listings/:id/buy`) finds two distinct pure-ADA UTxOs in the Head — one for buyer input, one for collateral.

**Requirement:** Need ≥ 2 pure-ADA UTxOs in the Head. Use `POST /api/head/split-ada` after opening.

### 5.2 `buildEscrowTxUnsigned` — only locks 1 token unit

**Symptom:** Escrow always locked `1 tokenUnit` regardless of actual quantity. For a UTxO with 1000 Maiz tokens, the cardano-cli command would produce an unbalanced tx (999 tokens disappearing).

**Fix:** Added `inputQuantity?: bigint` parameter. Escrow now locks the full token quantity. Change = `inputLovelace - minLovelace - fee` (ADA only; no token change needed when locking all tokens). The listing handler extracts the quantity from the Head UTxO snapshot.

### 5.3 Hydra incremental commit (deposit) broken in v1.2.0 — FIXED in v1.3.0

**Original symptom (v1.2.0):** `POST /commit` while Head is Open confirms on L1 at the deposit script address but Hydra never emits `CommitRecorded`. `pendingDeposits: {}` throughout.

**Root cause (diagnosed from HeadV1 spec, section 6.4 tick handler):**
The deposit lifecycle had a math flaw: `D.created` was set to `t_max` of the depositTx (= `T_draft + depositPeriod`), and `deadline = T_draft + 2 × depositPeriod`. This made the Active condition (`t > D.created + T_deposit = T_draft + 2×T_deposit`) unreachable because the Expired condition (`t > D.deadline - T_deposit = T_draft + T_deposit`) was evaluated first and triggered at the exact same wall-clock moment. Deposits went Inactive → Expired immediately, never reaching Active, so `CommitRecorded` was never emitted.

**Fix:** Hydra v1.3.0 release note: *"correctly handles deposits and decommits on chain rollbacks and handles its local state correctly in terms of keeping track of pending deposits (#2491)"* + *"Fixed another race-condition around incremental commits/decommits (#2500)"*.

**Action taken:** Upgraded to Hydra v1.3.0 (2026-03-30). New preprod script TX IDs applied to `start.sh`.

### 5.4 Head got stuck in Closed state

**Symptom:** Head was `Closed`. Sending `{"tag":"Close"}` returned `CommandFailed`.

**Diagnosis:** Head was already closed. Contestation deadline: `2026-03-29T00:49:53Z`.

**Fix:** Waited for deadline, then sent `{"tag":"Fanout"}` → `HeadIsFinalized` → `Idle`. Then re-initialized.

### 5.5 `HeadIsInitializing` event not handled

**Symptom:** After `{"tag":"Init"}`, the backend's `getHeadStatus()` returned `Idle` instead of `Initializing` because the event was not handled in `applyEvent()`.

**Fix:** Added `case "HeadIsInitializing": this.headStatus = "Initializing"` to `client.ts`.

### 5.6 `CollectCommand` missing from `HydraCommand` type

`HydraCommand` union type in `types/hydra.ts` only had `Init | Close | Fanout | NewTx`. Added `CollectCommand { tag: "Collect" }`.

### 5.7 WSL path mangling in Bash commands

When running bash commands from Windows via `wsl.exe -e`, Windows Git Bash can mangle Unix paths starting with `/`. Use `wsl.exe -d Ubuntu-24.04 -- bash -c '...'` with `dangerouslyDisableSandbox: true`.

### 5.8 cardano-cli 10.x — txid returns JSON

`cardano-cli latest transaction txid` returns `{"txhash":"..."}` not a plain string. Fixed in `cli.ts` with try/catch JSON parse.

### 5.9 Aiken stdlib v3 — various

- `assets.add` is 4-arg: `assets.add(self, policy_id, asset_name, qty)`
- No `VerificationKeyCredential` — use `VerificationKey(vkh)`
- `use` imports must all be at top of file
- Multi-line values in record literals need `let` extraction

### 5.10 Migration 002 — wrong column name

`tx_submissions` has `submitted_at`, not `created_at`. Fixed index in `002_production_indexes.sql`.

### 5.11 `NotEnoughFuel` on combined commit — Init tx sibling bug (CRITICAL)

**Symptom:** `POST /api/crops/build-commit-tx` (combined commit of farmer CropToken + operator ADA) returned `NotEnoughFuel` from Hydra. Committing only the farmer's CropToken worked fine.

**Root cause:** The Head's Init transaction (`0523c5629...`) produced two relevant UTxOs:
- `#1` — the head state UTxO (at the Hydra HEAD script address — required input for every commit tx)
- `#2` — the operator's ADA change (86 ADA at the operator's address)

When the backend tried to commit `0523c5629...#2` as the operator's ADA contribution, Hydra built the commit tx with inputs `[0523c5629...#1 (head state), 0523c5629...#2 (being committed), 8ac9...#0 (farmer token)]`. Hydra could not find a fuel UTxO because the only "non-committed" UTxO from the same Init tx (`0523c5629...#1`) is already consumed as the head state input. Hydra's fuel selection logic fails when all sibling UTxOs of the Init tx are already used.

**Fix:** Modified `build-commit-tx` to try operator UTxOs in descending ADA order, skipping any that cause `NotEnoughFuel`. The `0523c5629...#2` UTxO is skipped; `8fa4e8aa...#0` (44 ADA, from a different tx) is used as the committed operator ADA. Hydra then uses `0523c5629...#2` as fuel automatically.

**Key insight:** A UTxO produced by the Init transaction **cannot be committed** to the Head — it will always trigger `NotEnoughFuel`. It can only be used as fuel.

---

## 6. Known Preprod State (2026-03-30)

### Active processes

| Process | Version | tmux session | Port |
|---------|---------|--------------|------|
| cardano-node | 10.6.2 | (background) | 6000 |
| hydra-node | **1.3.0** | hydra-marketplace | 4001 |
| backend (tsx) | — | hydra-backend | 3000 |
| frontend (next dev) | — | hydra-frontend | 3001 |

**⚠ Head must be re-initialized after upgrade** (v1.3.0 uses different script TX IDs).

### Restart commands

```bash
# Backend (in tmux hydra-backend session)
tmux send-keys -t hydra-backend C-c
tmux send-keys -t hydra-backend 'cd /home/rodrigo/hydra-nft-marketplace/backend && npx tsx src/index.ts 2>&1 | tee /tmp/backend.log' Enter

# Frontend auto-reloads (next dev --hot)

# Hydra node (in tmux hydra-marketplace session)
tmux send-keys -t hydra-marketplace C-c
# then restart with the full hydra-node command (see hydra/scripts/start.sh)
```

### Key paths

```
cardano-cli:      /home/rodrigo/workspace/hydra_test/bin/cardano-cli
hydra-node:       /home/rodrigo/workspace/hydra_test/hydra-bin/hydra-node
node socket:      /home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
operator skey:    /home/rodrigo/hydra-nft-marketplace/hydra/keys/cardano.skey
hydra skey:       /home/rodrigo/hydra-nft-marketplace/hydra/keys/hydra.sk
protocol params:  /home/rodrigo/hydra-nft-marketplace/hydra/keys/protocol-parameters.json
persistence:      /home/rodrigo/hydra-nft-marketplace/hydra/data
```

### Known L1 UTxOs (last verified 2026-03-29)

| Address | UTxO ref | Contents | Role |
|---------|----------|----------|------|
| pepito | `8ac96ab6...#0` | 2 ADA + 1000 Maiz pepito (policyId `111da66...`) | commit to Head |
| pepito | `9dfc152c...#0` | 2 ADA + 1000 coliflor pepito | commit to Head |
| operator | `0523c562...#2` | ~86 ADA (Init tx sibling — cannot be committed, use as fuel) | fuel only |
| operator | `8fa4e8aa...#0` | ~44 ADA | commit to Head as operator ADA |
| operator | `38701a96...#1` | ~7.8 ADA | spare fuel / collateral |

**NOTE:** `0523c562...#2` is from the same transaction as the head state UTxO `0523c562...#1`. It **cannot** be committed to the Head (Hydra `NotEnoughFuel`). It can only be used as L1 fuel.

Pepito's address: `addr_test1qrgff35ks084ej5va4y2cc88092rfcgcdwr4zjtcq238sv9edtserxw9vp4fe9a86wl9r3vm7nu6gw0z8z96akylkm6sy6xm6t`

### CropToken policy ID

`111da6625fa277baf894d3c16f799349a44cd8713e55ac7c3c950c4d`

---

## 7. API Endpoints

### Head management (new 2026-03-29)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/head/status` | Current head session from DB + live hydra status |
| GET | `/api/head/utxos` | Live UTxO snapshot from `GET /snapshot/utxo` |
| POST | `/api/head/init` | Send `{"tag":"Init"}` (Head must be Idle) |
| POST | `/api/head/collect` | Send `{"tag":"Collect"}`, await HeadIsOpen, record session in DB |
| POST | `/api/head/split-ada` | Intra-Head ADA split (body: `{splitLovelace?: number}`, default 20 ADA) |

### CropToken commit (updated 2026-03-29)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/crops/build-commit-tx` | Combined commit: farmer token + operator ADA. Operator pre-signs. Returns partially-signed CBOR. |
| POST | `/api/crops/submit-commit-tx` | Submit fully-signed CBOR to L1 |

### Listings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/listings` | Browse (filter: status, limit, offset) |
| GET | `/api/listings/:id` | Single listing + sale |
| POST | `/api/listings` | Create draft → returns unsigned escrow CBOR (full token qty) |
| POST | `/api/listings/:id/escrow-confirm` | Submit signed escrow CBOR → activates listing |
| POST | `/api/listings/:id/buy` | Buy (operator-signed, buyer-funded) |
| GET | `/api/listings/:id/cancel-tx` | Unsigned cancel CBOR for seller |
| POST | `/api/listings/:id/cancel` | Submit signed cancel CBOR |

### Farmers

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/farmers/register` | Submit KYC |
| GET | `/api/farmers/status/:address` | Registration status |
| GET | `/api/farmers/stats/:address` | Sales stats (active, sold, revenue, recent sales) |
| POST | `/api/crops/build-mint-tx` | Build unsigned L1 CropToken mint tx |
| POST | `/api/crops/submit-mint-tx` | Submit signed L1 mint tx |
| GET | `/api/crops/wallet/:address` | L1 CropTokens in wallet |
| GET | `/api/crops/:address` | Crop mint records in DB |

### Wallet / Deposits

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wallet/balance/:address` | In-Head UTxOs for address (from snapshot) |
| GET | `/api/wallet/l1-balance/:address` | L1 UTxOs via Blockfrost |
| POST | `/api/wallet/deposit` | Build incremental commit tx (blueprint → Hydra `/commit`). Returns `commitTxCbor` for user to sign. |
| POST | `/api/wallet/submit-l1-tx` | Submit signed tx CBOR to L1 via Blockfrost |
| POST | `/api/wallet/withdraw` | Request decommit of an in-Head UTxO back to L1 |

### Admin (`X-Admin-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/events` | Recent hydra_events |
| GET | `/api/admin/stats` | Aggregate counts |
| POST | `/api/admin/head/close` | Send Close |
| POST | `/api/admin/head/fanout` | Send Fanout |
| GET | `/api/admin/farmers/pending` | Pending KYC |
| POST | `/api/admin/farmers/:id/approve` | Approve + FarmerPass tx hash |
| POST | `/api/admin/farmers/:id/reject` | Reject |

---

## 8. How to Run (2026-03-29)

### Prerequisites

All commands inside WSL `Ubuntu-24.04`.

```bash
# Cardano node (already running as daemon)
ls /home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket  # must exist

# Hydra node (starts in tmux hydra-marketplace)
# Already running — check with: tmux attach -t hydra-marketplace
```

### Start sequence

```bash
# 1. Backend
tmux new-session -d -s hydra-backend 'cd /home/rodrigo/hydra-nft-marketplace/backend && npx tsx src/index.ts 2>&1 | tee /tmp/backend.log'

# 2. Frontend
tmux new-session -d -s hydra-frontend 'cd /home/rodrigo/hydra-nft-marketplace/frontend && npm run dev -- --port 3001'

# 3. Verify
curl http://127.0.0.1:3000/api/health | jq
# → {"ok":true,"hydra":"connected","headStatus":"..."}
```

### Head lifecycle (start fresh)

```bash
# If Head is Final/Idle, init a new one:
curl -X POST http://127.0.0.1:3000/api/head/init
# → {"ok":true,"message":"Init command sent"}
# Wait for HeadIsInitializing (~10-30s on preprod)

# Check status:
curl http://127.0.0.1:3000/api/health | jq .headStatus
# → "Initializing"
```

Then in the browser:
1. `/portfolio`: Connect wallet → select token UTxO → click **"Depositar al marketplace"** → wallet signs commit tx → backend submits to L1 via Blockfrost
2. Wait for `CommitFinalized` SSE (~deposit period) → toast "Token disponible"
3. `/sell`: Select token → fill price → **"Publicar"** → wallet signs escrow tx
4. Token is now listed in the marketplace

### Environment variables

**`backend/.env`:**
```bash
HYDRA_WS_URL=ws://127.0.0.1:4001
HYDRA_HTTP_URL=http://127.0.0.1:4001
DATABASE_URL=postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace
PORT=3000
CARDANO_CLI_PATH=/home/rodrigo/workspace/hydra_test/bin/cardano-cli
SKEY_PATH=/home/rodrigo/hydra-nft-marketplace/hydra/keys/cardano.skey
TESTNET_MAGIC=1
CARDANO_NODE_SOCKET_PATH=/home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
OPERATOR_ADDRESS=<operator bech32 address>
SCRIPT_ADDRESS=addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm
SCRIPT_CBOR=<double-CBOR from plutus.json>
TX_FEE=0
ADMIN_SECRET=changeme
PROTOCOL_PARAMS_PATH=/home/rodrigo/hydra-nft-marketplace/hydra/keys/protocol-parameters.json
```

---

## 9. Demo Flow (Step by Step)

This is the complete end-to-end demo flow tested 2026-03-29:

### Phase 1 — Setup (one-time)

1. Admin approves pepito's KYC at `/admin`
2. Admin mints FarmerPass for pepito (L1 tx, manually via cardano-cli, pastes hash in admin panel)
3. Pepito mints CropTokens at `/identity` → Crop tab → fills crop name + quantity → signs tx in wallet

### Phase 2 — Commit (per Head session)

4. Check Head status: `curl http://127.0.0.1:3000/api/health | jq .headStatus`
5. If Idle: `curl -X POST http://127.0.0.1:3000/api/head/init`
6. Wait for `Initializing` (~20s)
7. Pepito goes to `/sell`, selects token, clicks **Commit al Head** → signs (partialSign)
8. After commit tx on L1 (~60s): click **Abrir Head** → waits for `HeadIsOpen`
9. Click **Dividir ADA** → splits operator ADA into 2 UTxOs

### Phase 3 — Trade

10. Token now shows **"En el Head ✓"**
11. Pepito fills price → **Publicar** → signs escrow tx in wallet
12. Buyer goes to `/listings` → clicks Buy → backend submits buy tx to Hydra → instant confirmation
13. Sale record created in DB; listing marked `sold`

### Phase 4 — Close (end of demo)

14. Admin sends Close from `/admin` (or `POST /api/admin/head/close`)
15. Wait contestation period (180s in env, but Head was opened with 600s — check actual value)
16. Admin sends Fanout → UTxOs returned to L1

---

## 10. Database Schema

```
head_sessions        — one row per Hydra Head session
listings             — draft→active→sold/cancelled/failed; stores escrow_tx_hash, escrow_utxo_ix
sales                — confirmed purchases; hydra_tx_id set on TxValid
tx_submissions       — audit log; request_id for idempotency
hydra_events         — raw WS event log
assets               — NFT metadata cache (not auto-populated)

farmer_registrations — KYC; status: pending→approved/rejected; farmer_pass_tx_hash set on L1 mint
crop_mints           — crop lot records; tx_hash set on L1 confirm
```

---

## 11. What Is Still Incomplete

| Gap | Priority | Notes |
|-----|----------|-------|
| FarmerPass auto-mint from backend | P2 | Operator currently pastes tx hash manually into admin panel |
| CropToken burned on buy | P3 | Buy tx does not include a burn redeemer — tokens just move to buyer address. Fine for demo. |
| Head session DB cleanup after fanout | P2 | `head_sessions` row stays `open` after fanout; should be updated to `closed` on `HeadIsFinalized` event |
| E2E test with live Head | P2 | E2E suite tests infrastructure only; not run with real CropToken in Head |
| Multi-party Head | P3 | Single-participant Head (operator only). Real marketplace needs 2+ nodes. |
| NFT metadata | P3 | `assets` table empty — ~~no display names~~ displayName fixed (hex→UTF-8); no images yet |
| TxInvalid txId matching | P2 | After BUG-001 fix, `TxInvalid` matching uses `event.transaction.txId?` (optional). Needs live testing to confirm `txId` is actually populated by Hydra v1.2.0. |
| ~~Portfolio page~~ | ~~P3~~ | ✅ Implemented with Deposit/Withdraw buttons |
| DB reconciliation job | P2 | T10.3: no automatic DB↔Hydra UTxO reconciliation; orphaned UTxOs require manual SQL fixes |

---

## 12. Change Log

### 2026-03-30 (session 4) — Hydra v1.3.0 upgrade + UX overhaul (Opciones A & B)

#### Hydra upgrade: v1.2.0 → v1.3.0

- Binary replaced: `~/workspace/hydra_test/hydra-bin/hydra-node` → `1.3.0-7ccf541`
- `hydra/scripts/start.sh`: 3 preprod script TX IDs updated to v1.3.0 values
- `hydra/config/.env`: version comment updated
- Backup stored at `hydra-node.1.2.0.bak`
- **Breaking:** v1.3.0 rejects node inputs if >50% of contestation period out of sync; `TickObserved.chainSlot` renamed to `chainPoint` (no impact — not parsed in our code)
- **Head must be closed (Fanout) and re-initialized before operating with v1.3.0 scripts**

#### Opción A — Incremental deposit / withdraw UI

Files changed:
- `backend/src/types/hydra.ts`: Added `CommitRecorded`, `CommitApproved`, `CommitFinalized`, `DecommitRequested`, `DecommitApproved`, `DecommitInvalid`, `DecommitFinalized` to `HydraEventTag`
- `backend/src/api/events.ts`: Added same tags to `RELAY_TAGS` — now relayed to browser via SSE
- `backend/src/api/wallet.ts`: New `POST /wallet/submit-l1-tx` — submits signed tx CBOR to Blockfrost `/tx/submit`
- `frontend/lib/api.ts`: Added `deposit()`, `submitL1Tx()`, `withdraw()` methods
- `frontend/app/portfolio/page.tsx`: Full rewrite — shows L1 UTxOs with "Depositar al marketplace" button (token UTxOs only), Head UTxOs with "Retirar" button, "En tránsito" banner for pending deposits, SSE-driven auto-refresh on `CommitFinalized`/`DecommitFinalized`

#### Opción B — Dashboard de productor + toasts

Files changed:
- `backend/src/api/farmers.ts`: New `GET /farmers/stats/:address` — active listings, total sold, total revenue, last 5 sales
- `frontend/lib/api.ts`: Added `FarmerStats` interface + `farmerStats()` method
- `frontend/components/ToastProvider.tsx`: New — global SSE-driven toast system (bottom-right, 5s auto-dismiss). Events → toasts: `CommitFinalized`, `DecommitFinalized`, `FarmerApproved`, `HeadIsClosed`, `HeadIsOpen`, `hydra:disconnected`, `hydra:connected`
- `frontend/app/layout.tsx`: Mounted `ToastProvider` globally
- `frontend/app/dashboard/page.tsx`: New page — stats grid, active listings with escrow status, last 5 sales, marketplace status badge, quick actions
- `frontend/components/Navbar.tsx`: Added "Dashboard" link
- `frontend/tailwind.config.ts`: Added `animate-fade-in` keyframe + missing `hydra-400/700/800` color tokens

#### UX improvements (previous session, now fully operational)

- `SellForm.tsx`: Removed all Hydra lifecycle UI (Commit/Collect/Split buttons). Seller flow: select token → price → sign escrow → done.
- `BuySection.tsx`: Spanish text, 3-step progress, receipt modal with txId
- `ListingsGrid.tsx`: Client component with SSE subscription, refreshes on `TxValid`/`SnapshotConfirmed`
- `KycForm.tsx`: SSE subscription for `FarmerApproved` — auto-updates status without page reload
- `frontend/app/page.tsx`: `revalidate: 60` (SSE handles real-time, no 5s polling)

### 2026-03-29 (session 3) — Hydra v1.2.0 TxValid API fix + confirmation timeouts + display names + escrow signing

#### Root cause confirmed: `awaitTxConfirmation` always timed out (CRITICAL)

The official Hydra v1.2.0 OpenAPI schema (`hydra-node/json-schemas/api.yaml`) was fetched and compared against local types. Finding: the `TxValid` event in Hydra v1.2.0 has **no `transaction` object** — it sends `transactionId` as a top-level field. Our local `TxValidEvent` type incorrectly modeled this as `transaction: { id: string; cborHex: string }`.

Effect: `event.transaction?.id === txId` was always `undefined === txId` → always `false` → every `awaitTxConfirmation` call timed out after 30s (later bumped to 60s), falling through to the snapshot fallback on every request.

Similarly, `TxInvalid` has a `transaction` object (TextEnvelope) with an optional `txId` field — not an `id` field.

#### `backend/src/types/hydra.ts`
- `TxValidEvent`: removed `transaction: { id: string; cborHex: string }`, added `transactionId: string`
- `TxInvalidEvent`: updated `transaction` to `{ type: string; description: string; cborHex: string; txId?: string }`

#### `backend/src/hydra/client.ts`
- `awaitTxConfirmation`: `event.transaction?.id` → `event.transactionId` (TxValid) and `event.transaction?.txId` (TxInvalid)
- `summarize`: updated both branches to use the corrected field names

#### `backend/src/db/eventStore.ts`
- `onTxValid`: `event.transaction.id` → `event.transactionId`
- `onTxInvalid`: `event.transaction.id` → `event.transaction.txId ?? ""`

#### `backend/src/api/listings.ts` (prior in this session)
- Added `pollSnapshotForEscrow` / `pollSnapshotForTx` snapshot fallback to escrow-confirm and buy-confirm endpoints. Tried `awaitTxConfirmation(60s)`, on timeout polled `hydra.getUtxos()` every 2s for 15s. This interim fix worked correctly via snapshot — now `awaitTxConfirmation` resolves immediately after BUG-001 fix. Fallback kept as defense-in-depth.
- Added `hexToUtf8` helper + `displayName` field in `toApiListing`: decodes hex `asset_name` to UTF-8 for display (returns `null` for binary names). Verified: API returns `"displayName": "Lentejas pepito"`.

#### `backend/src/tx/cli.ts`
- `buildEscrowTxUnsigned`: added `--required-signer-hash ${opts.sellerVkh}` to declare the seller's key as required signer. CIP-30 wallets use this field to sign UTxOs that are not visible on L1 (because they are inside the Hydra Head).

#### Operational fixes (manual SQL / Hydra tx)
- **Merged operator UTxOs in Head**: two 20 ADA UTxOs → one 39.8 ADA UTxO using `cardano-cli build-raw` submitted directly to Hydra. Fee required iteration (0 → 165413 → 165589 lovelace) because the tx size changes as the fee field grows.
- **Soja pepito orphaned at script address**: escrow-confirm timed out before fix → listing stayed `draft` → user retry → backend deleted draft → UTxO orphaned at script with no DB record. Fixed by inserting listing row manually.
- **Buy tx confirmed in snapshot but 502**: buy tx `438d7fa0...` was in Hydra snapshot but backend returned 502 due to confirmation timeout. Fixed DB manually: listing→sold, sale→confirmed with `hydra_tx_id`.

### 2026-03-29 — Classic Commit + Buy Fix + Head Management

#### Problem solved: incremental deposits broken
- Investigated Hydra 1.2.0 incremental commit (`POST /commit` while Head Open)
- Deposit tx confirmed on L1 but Hydra never emitted `CommitRecorded`
- `GET /commits` always returned `[]`; `pendingDeposits: {}` throughout
- Decision: abandon incremental deposits, use classic commit (pre-open) exclusively
- Closed stuck Head (fanout after deadline), re-initialized fresh

#### `backend/src/tx/cli.ts`
- `buildBuyTx`: Added `buyerInputRef`, `buyerInputLovelace`, `escrowTokenQty`, `changeAddress`. Fixed change calculation. Added buyer `--tx-in` to cardano-cli command.
- `buildEscrowTxUnsigned`: Added `inputQuantity?` param. Locks full token quantity at script.

#### `backend/src/api/listings.ts`
- `POST /listings`: Extracts `tokenQuantity` from Head UTxO snapshot; passes to `buildEscrowTxUnsigned`.
- `POST /listings/:id/buy`: Finds 2 pure-ADA UTxOs (buyer input + collateral). Extracts escrow token qty. Passes all to `buildBuyTx`. Returns clear error if < 2 pure-ADA UTxOs available.

#### `backend/src/api/head.ts`
- Added `POST /init`: sends `{"tag":"Init"}`
- Added `POST /collect`: sends `{"tag":"Collect"}`, awaits `HeadIsOpen`, records session in DB
- Added `POST /split-ada`: intra-Head ADA split tx (operator key signs)

#### `backend/src/api/farmers.ts`
- `POST /crops/build-commit-tx`: Combined commit body (farmer token + operator ADA). Operator pre-signs server-side. Returns partially-signed CBOR for farmer's browser wallet (`partialSign=true`).
- **2026-03-29 (session 2):** Fixed `NotEnoughFuel` — operator UTxO candidates are now tried in order; any that share the Init tx txHash (`0523c562...`) are skipped. `8fa4e8aa...#0` (44 ADA) is used as committed operator ADA; `0523c562...#2` becomes fuel automatically.

#### `backend/src/hydra/client.ts`
- Added `initHead()`, `collect()`, `awaitHeadOpen(timeoutMs)` methods
- Added `case "HeadIsInitializing"` to `applyEvent()` to update `headStatus`

#### `backend/src/types/hydra.ts`
- Added `CollectCommand { tag: "Collect" }` to `HydraCommand` union

#### `frontend/app/sell/SellForm.tsx`
- Shows Head status badge (Idle / Initializing / Open)
- Commit button only enabled when Head is `Initializing`
- After commit: shows **"Abrir Head"** button that calls `POST /collect` and polls to Open
- After Head open: shows **"Dividir ADA"** helper
- Submit button disabled when Head is not Open

#### `frontend/context/WalletContext.tsx` + `frontend/lib/wallet.ts`
- `signTx(cbor, partialSign?)` — passes through to `wallet.signTx(cbor, partialSign)`
- Used for combined-commit multi-sig flow

### 2026-03-28 — Farmer Identity System (Epic 13)

- `farmer_pass.ak`, `crop_token.ak` added; 26 tests total, all pass
- `listing.ak`: `quantity >= 1` (was `== 1`)
- Migration `003_farmer_identity.sql`, `farmerRepo.ts`, `farmers.ts`, admin endpoints
- `/identity` and `/admin` frontend pages
- `SellForm.tsx`: FarmerPass gate, plain-text crop name

### 2026-03-28 — Farmer-friendly sell form + migration fix

- `SellForm.tsx`: plain-text crop name → UTF-8 hex
- `002_production_indexes.sql`: `created_at` → `submitted_at`
