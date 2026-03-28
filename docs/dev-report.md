# Hydra NFT Marketplace — Development Report

**Last updated:** 2026-03-28
**Stack:** Aiken v1.1.19 · cardano-cli 10.x · Hydra v1.2.0 · TypeScript/Express · PostgreSQL · Next.js 14
**Network:** Cardano preprod (testnet-magic 1)

---

## 1. What Was Built

A fixed-price marketplace for agricultural crop tokens where all trades execute **inside a Hydra Head** (Cardano Layer 2). Farmers register with a privacy-preserving KYC (FarmerPass NFT on L1), then mint and sell fungible crop tokens (Arroz, Soja, Maíz, etc.) inside the Head.

| Epic | Description | Status |
|------|-------------|--------|
| 4  | Hydra WebSocket client + cardano-cli builder | ✅ |
| 5  | Listings backend (create, escrow-confirm, DB) | ✅ |
| 6  | Buy flow (operator-signed, collateral selection) | ✅ |
| 7  | Cancel flow (seller-signed, 2-step) | ✅ |
| 8  | Aiken listing validator (14 tests) | ✅ |
| 9  | Next.js 14 frontend (browse, sell, buy, cancel) | ✅ |
| 10 | State sync engine (SnapshotConfirmed catch-up, session recovery) | ✅ |
| 11 | Admin & observability (health, stats, request logging) | ✅ |
| 12 | E2E test suite (TypeScript, cardano-cli signing) | ✅ |
| 13 | Farmer identity system (FarmerPass + CropTokens) | ✅ backend/contracts · ⚠️ frontend partial |

---

## 2. Repository Layout

```
hydra-nft-marketplace/
├── Makefile
├── backend/
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── api/
│       │   ├── router.ts           # mounts all routers
│       │   ├── listings.ts         # 7 listing endpoints
│       │   ├── farmers.ts          # NEW: /farmers + /crops endpoints
│       │   ├── head.ts
│       │   ├── health.ts
│       │   ├── admin.ts            # + farmer approve/reject endpoints
│       │   ├── events.ts
│       │   └── middleware.ts
│       ├── db/
│       │   ├── migrations/
│       │   │   ├── 001_initial_schema.sql
│       │   │   ├── 002_production_indexes.sql
│       │   │   └── 003_farmer_identity.sql  # NEW
│       │   ├── migrate.ts
│       │   ├── farmerRepo.ts       # NEW: FarmerRepo + CropMint CRUD
│       │   ├── listingRepo.ts
│       │   ├── saleRepo.ts
│       │   ├── eventStore.ts
│       │   └── pool.ts
│       ├── hydra/
│       │   ├── client.ts
│       │   └── idempotency.ts
│       ├── sync/stateRecovery.ts
│       ├── tx/
│       │   ├── cli.ts
│       │   ├── mesh.ts
│       │   └── index.ts
│       ├── types/
│       │   ├── hydra.ts
│       │   └── marketplace.ts
│       └── utils/address.ts
├── contracts/
│   ├── aiken.toml
│   ├── plutus.json                 # Compiled output (3 validators)
│   └── validators/
│       ├── listing.ak              # Listing spend validator (14 tests)
│       ├── farmer_pass.ak          # NEW: FarmerPass mint policy (6 tests)
│       └── crop_token.ak           # NEW: CropToken mint policy (6 tests)
├── e2e/
│   ├── config.ts
│   ├── helpers.ts
│   └── test.ts
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── sell/SellForm.tsx       # Farmer-friendly (no hex fields)
│   │   ├── sell/page.tsx
│   │   ├── identity/               # NEW
│   │   │   ├── page.tsx            # /identity route
│   │   │   ├── IdentityTabs.tsx    # Tab switcher
│   │   │   ├── KycForm.tsx         # KYC form (sha256 in browser)
│   │   │   └── CropMintForm.tsx    # Register crop lots
│   │   ├── admin/                  # NEW
│   │   │   ├── page.tsx            # /admin route
│   │   │   └── AdminPanel.tsx      # Approve/reject farmers
│   │   ├── listings/[id]/
│   │   └── status/page.tsx
│   ├── components/
│   │   ├── Navbar.tsx              # + Identidad + Admin links
│   │   ├── HeadStatusBadge.tsx
│   │   └── ListingCard.tsx
│   └── lib/api.ts                  # + farmerStatus, farmerRegister, cropMint, cropList
└── hydra/
    ├── Makefile
    ├── keys/
    └── scripts/
```

---

## 3. Architecture Decisions

### 3.1 Seller-funded escrow model

The escrow UTxO holds the NFT + `priceLovelace` + min-ADA. The buyer does **not** contribute ADA. The operator builds and signs the buy tx entirely. Value flow:

```
escrow UTxO (NFT + price + minAda)
  → seller output (price ADA)
  → buyer output (NFT + minAda)
```

### 3.2 FarmerPass NFT (L1 identity token)

FarmerPass is an L1 NFT minted under a policy controlled by the operator:
- **Token name** = farmer's payment key hash (28 bytes) — enforces one pass per wallet
- **Datum** = `{ company_name, identity_hash, issued_at }`
- `identity_hash` = sha256("nombre:documento") — computed client-side; PII never stored anywhere
- Lives on L1 so it survives Hydra Head restarts
- When a Head reopens, the operator re-commits relevant UTxOs

### 3.3 CropToken (fungible, L2)

Crop tokens represent real-world commodity lots:
- Fungible (not NFT) — e.g. 1000 units of "Arroz"
- **Token name** = UTF-8 hex of crop name (e.g. `6172726f7a` for "arroz")
- Minting policy requires: (a) farmer signature + (b) FarmerPass as reference input
- Traded inside the Hydra Head; listing validator accepts `quantity_of >= 1` (not `== 1`)

### 3.4 No UTxO contention

The Pyth State NFT (if used) and the FarmerPass are always **reference inputs** — never spent. Multiple users can mint/trade in the same block without contention on the oracle or identity UTxO.

### 3.5 Two-step seller flows

List and Cancel require the seller's signature but the backend never holds the seller's key:
1. Backend builds unsigned tx CBOR → returns to frontend
2. Seller signs externally (cardano-cli or wallet)
3. Frontend posts signed CBOR back → backend submits to Hydra

### 3.6 State sync via SnapshotConfirmed

`onTxValid` → primary path (immediate update).
`onSnapshotConfirmed` → catch-up (re-apply confirmed txs after restart/reconnect).
`Greetings` → session recovery on reconnect.

---

## 4. Aiken Contracts

### 4.1 `listing.ak` — spend validator

**Redeemer branches:**

`Buy { buyer }` → `seller_paid` (lovelace ≥ price) + `buyer_receives_nft` (quantity ≥ 1)
`Cancel` → `seller_signed` + `nft_returned`

Note: changed from `quantity == 1` to `quantity >= 1` to support fungible CropTokens.

### 4.2 `farmer_pass.ak` — minting policy

```aiken
validator farmer_pass_policy(operator_pkh: VerificationKeyHash) {
  mint(_redeemer, _policy_id, tx) {
    list.has(tx.extra_signatories, operator_pkh)
  }
}
```

Exports `has_farmer_pass(tx, pass_policy_id, farmer_pkh)` helper — used by `crop_token.ak`.

### 4.3 `crop_token.ak` — minting policy

```aiken
validator crop_token_policy(farmer_pass_policy_id, operator_pkh) {
  mint(redeemer: CropAction, ...) {
    MintCrop { farmer_pkh } ->
      list.has(tx.extra_signatories, farmer_pkh) &&
      has_farmer_pass(tx, farmer_pass_policy_id, farmer_pkh)
    BurnCrop { owner_pkh } ->
      list.has(tx.extra_signatories, owner_pkh) ||
      list.has(tx.extra_signatories, operator_pkh)
  }
}
```

### 4.4 Test suite (26 tests, all pass)

| Module | Tests | All pass |
|--------|-------|----------|
| `listing` | 14 | ✅ |
| `farmer_pass` | 6 | ✅ |
| `crop_token` | 6 | ✅ |
| **Total** | **26** | ✅ |

```bash
cd contracts
/home/rodrigo/.aiken/versions/v1.1.19/.../aiken check   # 26/26 pass
/home/rodrigo/.aiken/versions/v1.1.19/.../aiken build   # → plutus.json
```

### 4.5 Compiled output

- **Listing script hash:** `8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc`
- **Listing address (preprod):** `addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm`
- FarmerPass and CropToken script hashes are in `contracts/plutus.json` but **not yet deployed** — they still need to be parameterised with the actual operator PKH and committed to preprod.

---

## 5. Bugs Encountered and Fixed

### 5.1 cardano-cli 10.x — txid returns JSON, not a plain string

`cardano-cli latest transaction txid` returns `{"txhash":"..."}` in v10.x. Fixed in `cli.ts` with try/catch JSON parse.

### 5.2 Aiken stdlib v3 — `assets.add` takes 4 arguments

`assets.add(self, policy_id, asset_name, qty)` — not 2-argument.

### 5.3 Aiken stdlib v3 — no `VerificationKeyCredential`

Use `cardano/address.{VerificationKey}` and `VerificationKey(vkh)`.

### 5.4 Aiken — `use` imports must be at the top of the file

The Aiken parser rejects `use` statements anywhere except the very top of the file. If tests require extra imports (e.g. `use cardano/assets`), they must be declared at the top even if only used in the test section. Placing `use` after any type/function definition causes a parse error.

### 5.5 Aiken — multi-line value in record literal causes parse error

Extract multi-line expressions to `let` bindings before using them in record literals.

### 5.6 `@types/express` v5 — params typed as `string | string[]`

Use `req.params["id"] as string`.

### 5.7 TxInvalid with fee=0

Hydra node must be started with `protocol-parameters-zero-fees.json`. Set `TX_FEE=0` in backend `.env`.

### 5.8 Migration 002 — wrong column name

`tx_submissions` has `submitted_at`, not `created_at`. Fixed index definition in `002_production_indexes.sql`.

### 5.9 Aiken — `buy_nft_quantity_two` test semantic change

After changing `quantity_of == 1` to `>= 1` in `listing.ak`, the test `buy_nft_quantity_two` changed from an expected-fail to an expected-pass. Removed the `fail` annotation.

---

## 6. Database Schema

```
head_sessions        — one row per Hydra Head session
listings             — NFT listings; status: draft→active→sold/cancelled/failed
sales                — confirmed purchases
tx_submissions       — audit log of every tx sent to Hydra
hydra_events         — raw Hydra WS event log
assets               — optional NFT metadata cache

farmer_registrations — KYC submissions; status: pending→approved/rejected
                       company_name (public), identity_hash (sha256, private)
                       farmer_pass_tx_hash set when operator mints on L1
crop_mints           — crop lot records linked to approved farmers
                       crop_name (plain), asset_name_hex (UTF-8 hex), quantity, price_lovelace
```

Key constraints:
- `UNIQUE INDEX listings_active_unit WHERE status = 'active'` — one active listing per unit
- `farmer_registrations.wallet_address UNIQUE` — one registration per wallet
- `crop_mints.farmer_address → farmer_registrations(wallet_address)` — FK enforces approved farmer

---

## 7. API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness (DB + Hydra + head status) |
| GET | `/api/head/status` | Current head session |
| GET | `/api/listings` | Browse listings (filter: status, limit, offset) |
| GET | `/api/listings/:id` | Single listing + sale |
| POST | `/api/listings` | Create listing → unsigned escrow CBOR |
| POST | `/api/listings/:id/escrow-confirm` | Submit signed escrow CBOR |
| POST | `/api/listings/:id/buy` | Buy (operator-signed) |
| GET | `/api/listings/:id/cancel-tx` | Unsigned cancel CBOR for seller |
| POST | `/api/listings/:id/cancel` | Submit signed cancel CBOR |
| POST | `/api/farmers/register` | Submit KYC (identity_hash computed in browser) |
| GET | `/api/farmers/status/:address` | Check own registration status |
| POST | `/api/crops/mint` | Record crop mint intent (requires approved status) |
| GET | `/api/crops/:address` | List farmer's crop lots |

### Admin (`X-Admin-Key` header required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/events` | Recent hydra_events |
| GET | `/api/admin/tx-submissions` | All tx submissions |
| GET | `/api/admin/stats` | Aggregate counts |
| POST | `/api/admin/head/close` | Send Close to Hydra node |
| POST | `/api/admin/head/fanout` | Send Fanout |
| GET | `/api/admin/farmers/pending` | Pending KYC queue |
| POST | `/api/admin/farmers/:id/approve` | Approve + set FarmerPass tx hash |
| POST | `/api/admin/farmers/:id/reject` | Reject with reason |

---

## 8. How to Run

### Prerequisites

```bash
# All commands inside WSL Ubuntu-24.04
/home/rodrigo/workspace/hydra_test/bin/cardano-cli
/home/rodrigo/workspace/hydra_test/hydra-bin/hydra-node
/home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
```

### 1. PostgreSQL

```bash
sudo service postgresql start
```

### 2. Hydra node

```bash
cd /home/rodrigo/hydra-nft-marketplace
make hydra-start
make hydra-init
bash hydra/scripts/commit.sh
```

### 3. Backend

```bash
cd backend && npm run dev   # port 3000
```

### 4. Frontend

```bash
cd frontend && npm run dev -- --port 3001   # port 3001
```

### Environment variables

**`backend/.env`:**
```bash
HYDRA_WS_URL=ws://127.0.0.1:4001
DATABASE_URL=postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace
PORT=3000
CARDANO_CLI_PATH=...
SKEY_PATH=...
TESTNET_MAGIC=1
SCRIPT_ADDRESS=addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm
SCRIPT_CBOR=<double-CBOR>
TX_FEE=0
ADMIN_SECRET=changeme
```

**`frontend/.env.local`:**
```bash
NEXT_PUBLIC_DEMO_POLICY_ID=8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc
NEXT_PUBLIC_ADMIN_KEY=changeme
```

---

## 9. Testing

### On-chain (Aiken) — 26 tests, all pass

```bash
cd contracts
aiken check    # 26/26
aiken build    # → plutus.json
```

### E2E suite

```bash
make e2e-infra   # infrastructure checks (no NFT needed)
make e2e         # full flow (requires real NFT in Head)
```

---

## 10. Known Limitations

1. **Single-party Head.** Both participants use the same key. A real marketplace needs 2+ hydra-nodes.
2. **Operator collateral.** Buy tx uses operator's UTxO as Plutus collateral — needs replenishing.
3. **No NFT metadata.** `assets` table not auto-populated; no images/display names.
4. **No CIP-30 wallet.** Sellers sign CBOR manually. No browser wallet integration.
5. **In-memory idempotency store.** Lost on backend restart.
6. **Zero-fee Head only.** `TX_FEE=0` requires `protocol-parameters-zero-fees.json`.

---

## 11. What Was Learned

### Hydra
- `Greetings` (not `HeadIsOpen`) is the correct reconnect recovery event.
- `SnapshotConfirmed.snapshot.confirmedTransactions` is the reliable catch-up mechanism.
- `GET /snapshot/utxo` is the ground truth after restart.

### Aiken stdlib v3
- `assets.add` is 4-arg; `VerificationKey(vkh)` not `VerificationKeyCredential`.
- `use` imports must all be at the top of the file — no exceptions.
- `fail` tests: body must evaluate to `False` or panic.

### Express v5 + TypeScript
- Route params typed as `string | string[]` — use `as string` cast.

### Seller-funded escrow
- Operator can build buy txs without buyer's key because all value is already in the escrow.

### cardano-cli v10
- `txid` returns JSON `{"txhash":"..."}` — always handle with try/catch.

---

## 12. Project State (2026-03-28)

### Complete and tested

| Component | Status |
|-----------|--------|
| Listing lifecycle (create → escrow → active → buy/cancel) | ✅ implemented, typecheck clean |
| Aiken contracts — 26 unit tests | ✅ all pass |
| DB migrations 001, 002, 003 | ✅ auto-run on startup |
| Farmer KYC API (register, status, approve, reject) | ✅ live on port 3000 |
| Crop mint API (record intent, list) | ✅ live, but DB only — no L2 tx |
| Frontend `/identity` page (KYC + Crops tabs) | ✅ typecheck clean |
| Frontend `/admin` operator panel | ✅ typecheck clean |
| State sync, session recovery | ✅ |
| E2E infrastructure checks | ✅ |

### Partial / pending

| Component | Gap |
|-----------|-----|
| FarmerPass L1 mint from backend | The operator mints manually (cardano-cli) and pastes the tx hash into the admin panel. No backend endpoint builds/signs the L1 minting tx automatically. |
| CropToken L2 mint tx | `POST /api/crops/mint` only records the intent in DB. It does **not** build or submit a Hydra transaction. The farmer's wallet never receives the actual tokens. |
| `/sell` FarmerPass gate | The sell form shows to any connected wallet. It should check `GET /api/farmers/status/:address` and block non-approved farmers. |
| Listing ↔ CropToken flow | After crop tokens are minted on L2, the farmer needs them in their wallet before they can list. The two steps (mint → list) are not yet connected in the UI. |
| E2E full flow tests | Not run against a live Head with a real CropToken. |

---

## 13. What's Missing — Prioritised

### Priority 1 — Minimum for a working demo

**A. CropToken L2 mint transaction** (`backend/src/api/farmers.ts`, `POST /api/crops/mint`)

Currently saves to DB only. Needs to:
1. Build a Hydra tx that mints `quantity` CropTokens under `crop_token_policy`
2. Attach the FarmerPass UTxO as reference input
3. Include a withdrawal from the `crop_token` verify script (or use the operator as cosigner)
4. Submit via `HydraClient.submitTx()`
5. Update `crop_mints.tx_hash` and `status` on `TxValid`

**B. `/sell` FarmerPass gate** (`frontend/app/sell/SellForm.tsx`)

Add a `useEffect` that calls `api.farmerStatus(address)` and shows a banner if not approved:
```
⚠ Necesitás un FarmerPass aprobado para publicar. Ir a Identidad →
```

### Priority 2 — Operator UX improvements

**C. FarmerPass L1 mint from backend** (`backend/src/api/admin.ts`)

Add a `POST /api/admin/farmers/:id/mint-pass` endpoint that:
1. Gets the farmer's wallet address from `farmer_registrations`
2. Calls `cardano-cli transaction build` on L1 (not Hydra) to mint the FarmerPass NFT
3. Signs with the operator's key (`SKEY_PATH`)
4. Submits via Blockfrost
5. Stores the resulting tx hash in `farmer_pass_tx_hash` and sets `status = 'approved'`

This replaces the current manual flow where the operator mints externally and pastes the hash.

**D. Sell page language** — update title from "List an NFT" to "Publicar lote de cultivo".

### Priority 3 — Production readiness

- Replace `sleep(3000)` in E2E with polling
- CIP-30 wallet integration (Eternl/Nami) for in-browser signing
- NFT metadata indexer (populate `assets` table from Blockfrost)
- Multi-party Hydra Head (2+ participants)
- Docker Compose for backend + frontend + PostgreSQL

---

## 14. Quick-Start Checklist

```
[ ] sudo service postgresql start
[ ] ls /home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
[ ] cd /home/rodrigo/hydra-nft-marketplace && make hydra-start
[ ] (if Head not open) make hydra-init → bash hydra/scripts/commit.sh
[ ] tmux new-session -s hydra-backend -d "cd backend && npm run dev"
[ ] tmux new-session -s hydra-frontend -d "cd frontend && npm run dev -- --port 3001"
[ ] curl http://localhost:3000/api/health | jq   → ok: true
[ ] make e2e-infra
[ ] open http://localhost:3001
```

---

## 15. Change Log

### 2026-03-28 — Farmer Identity System (Epic 13)

#### Contracts
- Added `farmer_pass.ak`: operator-controlled minting policy for FarmerPass NFTs. Token name = farmer PKH; exports `has_farmer_pass()` helper.
- Added `crop_token.ak`: fungible CropToken minting policy. Mint requires FarmerPass as reference input + farmer signature. Burn by owner or operator.
- Modified `listing.ak`: `quantity_of >= 1` (was `== 1`) to support fungible tokens. Updated `buy_nft_quantity_two` test from fail → pass.
- **Total tests: 26 (up from 14), all pass.**

#### Database
- Migration `003_farmer_identity.sql`: added `farmer_status` enum, `farmer_registrations` table, `crop_mints` table.

#### Backend
- `farmerRepo.ts`: CRUD for farmer registrations and crop mints.
- `farmers.ts`: `POST /api/farmers/register`, `GET /api/farmers/status/:address`, `POST /api/crops/mint`, `GET /api/crops/:address`.
- `admin.ts`: added `GET /api/admin/farmers/pending`, `POST /api/admin/farmers/:id/approve`, `POST /api/admin/farmers/:id/reject`.

#### Frontend
- `/identity` page: two tabs — KYC form (sha256 computed in-browser, PII never sent to server) and Crop Mint form (gated behind approved FarmerPass).
- `/admin` page: operator panel to review pending registrations, approve with FarmerPass tx hash, or reject with reason.
- Navbar: added "Identidad" and "Admin" links; renamed "Sell" → "Vender".
- `api.ts`: added `FarmerRegistration`, `CropMint` types and `farmerStatus`, `farmerRegister`, `cropMint`, `cropList` calls.
- `frontend/.env.local`: added `NEXT_PUBLIC_ADMIN_KEY=changeme`.

### 2026-03-28 — Farmer-friendly sell form + migration fix

- `SellForm.tsx`: replaced hex fields with plain-text crop name, quantity, and lot price. Auto-converts to UTF-8 hex. Policy ID from env var.
- `002_production_indexes.sql`: fixed `created_at` → `submitted_at` column reference on `tx_submissions`.
