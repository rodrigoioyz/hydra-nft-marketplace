# Hydra NFT Marketplace — Development Report

**Date:** 2026-03-28
**Stack:** Aiken v1.1.19 · cardano-cli 10.x · Hydra v1.2.0 · TypeScript/Express · PostgreSQL · Next.js 14
**Network:** Cardano preprod (testnet-magic 1)

---

## 1. What Was Built

A fixed-price NFT marketplace where all trades execute **inside a Hydra Head** (Cardano Layer 2). The full stack was built across 9 epics:

| Epic | Description | Status |
|------|-------------|--------|
| 4  | Hydra WebSocket client + cardano-cli builder | ✅ |
| 5  | Listings backend (create, escrow-confirm, DB) | ✅ |
| 6  | Buy flow (operator-signed, collateral selection) | ✅ |
| 7  | Cancel flow (seller-signed, 2-step) | ✅ |
| 8  | Aiken listing validator (14 tests, all pass) | ✅ |
| 9  | Next.js 14 frontend (browse, sell, buy, cancel) | ✅ |
| 10 | State sync engine (SnapshotConfirmed catch-up, session recovery) | ✅ |
| 11 | Admin & observability (health, stats, request logging) | ✅ |
| 12 | E2E test suite (TypeScript, cardano-cli signing) | ✅ |

---

## 2. Repository Layout

```
hydra-nft-marketplace/
├── Makefile                        # Root shortcuts (make backend, make e2e, etc.)
├── backend/                        # Express API + Hydra client + DB
│   └── src/
│       ├── index.ts                # Entry point, wires everything together
│       ├── config.ts               # All env vars in one place
│       ├── api/
│       │   ├── router.ts           # createApp(), mounts all routers
│       │   ├── listings.ts         # 7 listing endpoints
│       │   ├── head.ts             # GET /api/head/status
│       │   ├── health.ts           # GET /api/health
│       │   ├── admin.ts            # Admin endpoints (events, stats, close, fanout)
│       │   └── middleware.ts       # asyncHandler, apiError, requestLogger, errorHandler
│       ├── db/
│       │   ├── migrations/001_initial_schema.sql
│       │   ├── migrate.ts          # Auto-runs on startup
│       │   ├── eventStore.ts       # Persist + project every Hydra event
│       │   ├── listingRepo.ts      # CRUD for listings table
│       │   └── saleRepo.ts         # CRUD for sales table
│       ├── hydra/
│       │   ├── client.ts           # WebSocket client, reconnect, UTxO cache
│       │   └── idempotency.ts      # In-memory requestId dedup store
│       ├── sync/
│       │   └── stateRecovery.ts    # recoverSessionId + reconcileListings
│       ├── tx/
│       │   └── cli.ts              # CardanoCliBuilder (build-raw, sign, txid)
│       ├── types/
│       │   ├── hydra.ts            # All Hydra event/command types
│       │   └── marketplace.ts      # ListingDatum, ListingAction, BuiltTx
│       └── utils/
│           └── address.ts          # getPaymentKeyHash (cardano-cli address info)
├── contracts/
│   ├── aiken.toml
│   ├── plutus.json                 # Compiled output
│   └── validators/listing.ak       # The on-chain listing validator (332 lines, 14 tests)
├── e2e/
│   ├── config.ts                   # E2E env config
│   ├── helpers.ts                  # HTTP client, cardano-cli signer, test runner
│   └── test.ts                     # 6 tests (infra + list/buy + list/cancel)
├── frontend/
│   ├── app/
│   │   ├── page.tsx                # Browse listings (server component, revalidate 5s)
│   │   ├── sell/SellForm.tsx       # 2-step: create → sign escrow → activate
│   │   ├── listings/[id]/
│   │   │   ├── page.tsx            # Listing detail
│   │   │   ├── BuySection.tsx      # Buy modal (client)
│   │   │   └── CancelSection.tsx   # Cancel 2-step modal (client)
│   │   └── status/page.tsx         # System status dashboard
│   ├── components/
│   │   ├── Navbar.tsx
│   │   ├── HeadStatusBadge.tsx     # Shows DB + Hydra + Head status dots
│   │   └── ListingCard.tsx
│   └── lib/api.ts                  # Typed fetch wrapper for all endpoints
└── hydra/
    ├── Makefile                    # start, stop, init, commit, close, fanout
    ├── config/.env                 # Hydra node config
    ├── keys/                       # cardano.skey/vkey, hydra.sk/vk, cardano.addr
    ├── scripts/                    # start.sh, stop.sh, init.sh, commit.sh, etc.
    └── config/protocol-parameters-zero-fees.json
```

---

## 3. Architecture Decisions

### 3.1 Seller-funded escrow model

The escrow UTxO (locked at the Plutus script address) holds:
- The NFT itself
- `priceLovelace` (the sale price)
- `minAdaLovelace` (2 ADA min-UTxO requirement)

The buyer does **not** contribute ADA. Instead the escrow was pre-funded by the seller at listing time. This was the key design choice that makes the **buy flow operator-signed**: the operator's key can build the buy tx entirely, since the value flow is:

```
escrow UTxO (NFT + price + minAda)
  → seller output (price ADA)
  → buyer output (NFT + minAda)
```

The operator signs and submits to Hydra — no buyer wallet interaction required in the backend.

### 3.2 No UTxO contention

Inside the Hydra Head there is exactly one pool UTxO per listing (the escrow). Multiple listings can be active simultaneously. Concurrent buys on different listings don't contend.

### 3.3 Operator collateral

Plutus script spending requires a collateral input. The operator holds several pure-ADA UTxOs inside the Head. The buy flow auto-selects the first UTxO ≥ 5 ADA that isn't the escrow itself.

### 3.4 Two-step seller flows

Both **list** and **cancel** require the seller's signature, but the backend never holds the seller's key. Solution: 2-step pattern:

1. Backend builds the **unsigned** tx CBOR and returns it to the frontend
2. Frontend displays the CBOR; seller signs externally (cardano-cli or wallet)
3. Frontend posts the **signed** CBOR back; backend submits to Hydra

### 3.5 State sync via SnapshotConfirmed

Hydra emits `TxValid` immediately when a tx is accepted, then `SnapshotConfirmed` when a snapshot is finalised (containing a `confirmedTransactions` array). The `EventStore` handles both:

- `onTxValid` → primary path: update listing/sale status immediately
- `onSnapshotConfirmed` → catch-up: re-apply any confirmed txs that were missed (backend restart, dropped WS message)

On reconnect, `recoverSessionId` + `reconcileListings` rebuild state from the live snapshot.

---

## 4. The Aiken Contract (`contracts/validators/listing.ak`)

### Validator logic

A single `spend` validator with two redeemer branches:

**`Buy { buyer: VerificationKeyHash }`**
- `seller_paid`: at least one output to `VerificationKey(seller)` with `lovelace_of >= price`
- `buyer_receives_nft`: at least one output to `VerificationKey(buyer)` with `quantity_of(policy, name) == 1`

**`Cancel`**
- `seller_signed`: `list.has(tx.extra_signatories, seller)`
- `nft_returned`: at least one output to `VerificationKey(seller)` with the NFT

### Test suite (14 tests, all pass with `aiken check`)

| Test | Redeemer | Expected |
|------|----------|----------|
| `buy_valid` | Buy | pass |
| `buy_valid_excess_ada_to_seller` | Buy | pass |
| `buy_seller_underpaid` | Buy | fail |
| `buy_seller_output_missing` | Buy | fail |
| `buy_wrong_nft_policy` | Buy | fail |
| `buy_wrong_nft_name` | Buy | fail |
| `buy_nft_quantity_zero` | Buy | fail |
| `buy_nft_quantity_two` | Buy | fail |
| `buy_nft_to_wrong_address` | Buy | fail |
| `cancel_valid` | Cancel | pass |
| `cancel_no_signature` | Cancel | fail |
| `cancel_nft_not_returned` | Cancel | fail |
| `cancel_nft_to_wrong_address` | Cancel | fail |
| `cancel_wrong_signer` | Cancel | fail |

### Compiled output

- **Script hash:** `8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc`
- **Script address (preprod):** `addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm`
- **plutus.json:** `contracts/plutus.json` — `compiledCode` field is the single-CBOR output from Aiken

**Important:** The `SCRIPT_CBOR` in `backend/.env` is the **double-CBOR** encoding (needed by MeshSDK-style tools). It is set by wrapping the raw `compiledCode` with `applyCborEncoding()`. Don't use the raw value directly.

---

## 5. Bugs Encountered and Fixed

### 5.1 cardano-cli 10.x — txid returns JSON, not a plain string

**Problem:** `cardano-cli latest transaction txid` in v10.x returns:
```json
{"txhash":"abc123..."}
```
instead of just `abc123...`

**Fix (in `cli.ts` `sign()` method):**
```typescript
const raw = execSync(`${cardanoCliPath} latest transaction txid ...`).toString().trim();
try {
  return (JSON.parse(raw) as { txhash: string }).txhash;
} catch {
  return raw; // fallback for older versions
}
```

### 5.2 Aiken stdlib v3 — `assets.add` takes 4 arguments

**Problem:** Used `assets.add(from_lovelace(n), from_asset(policy, name, 1))` (2-arg form). Compiler error.

**Correct signature:**
```aiken
assets.add(self: Value, policy_id: PolicyId, asset_name: AssetName, qty: Int) -> Value
```

**Fix:** `assets.add(assets.from_lovelace(2_000_000), policy, nft_name, 1)`

### 5.3 Aiken stdlib v3 — no `VerificationKeyCredential`

**Problem:** `address.VerificationKeyCredential(vkh)` doesn't exist in stdlib v3.

**Correct import and usage:**
```aiken
use cardano/address.{VerificationKey}
// usage:
o.address.payment_credential == VerificationKey(seller)
```

### 5.4 Aiken — multi-line value in record literal causes parse error

**Problem:** Having a multi-line `assets.add(...)` call directly inside a record literal caused the parser to treat subsequent lines as extra fields.

**Fix:** Extract to a `let` binding:
```aiken
let val = assets.add(assets.from_lovelace(n), policy, name, 1)
Output { address: addr, value: val, datum: NoDatum, reference_script: None }
```

### 5.5 `@types/express` v5 — params typed as `string | string[]`

**Problem:** `req.params.id!` caused a TypeScript error because `@types/express` v5 types `params` values as `string | string[]`.

**Fix:** `const id = req.params["id"] as string;`

### 5.6 TxInvalid with fee=0

**Problem:** First test submission was rejected with `"fee too small"`. The Hydra node was configured with standard protocol params (non-zero fees) rather than `protocol-parameters-zero-fees.json`.

**Fix:** Restart hydra-node pointing to `hydra/config/protocol-parameters-zero-fees.json`. For the test, set `TX_FEE=165633` (the fee that was required by standard params) to verify the happy path first.

### 5.7 `@types/express` v5 — `HeadIsContested` type cast

**Problem:** `event as { headId: string }` caused TS error because the union type for `HydraEvent` didn't have enough overlap.

**Fix:** `event as unknown as { headId: string }`

### 5.8 `aiken new .` fails with dot as project name

**Problem:** `aiken new .` rejects `.` as a project name.

**Fix:** Manually created `aiken.toml` with `name = "hydra-marketplace/listing"` and created the directory structure by hand.

---

## 6. Database Schema (summary)

```
head_sessions   — one row per Hydra Head session (idle→open→closed→finalized)
listings        — one row per NFT listing; status: draft→active→sold/cancelled/failed
sales           — one row per confirmed purchase (pending→confirmed/failed)
tx_submissions  — tracks every tx submitted to Hydra (links to listing + action)
hydra_events    — raw event log (all Hydra WS messages persisted)
assets          — optional NFT metadata cache (display_name, image_url)
```

Key constraint: `UNIQUE INDEX listings_active_unit WHERE status = 'active'` — only one active listing per NFT unit at a time.

---

## 7. API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness probe (DB + Hydra + head status) |
| GET | `/api/head/status` | Current head session details |
| GET | `/api/listings` | List NFTs (filter: status, limit, offset) |
| GET | `/api/listings/:id` | Single listing + sale info |
| POST | `/api/listings` | Create listing → returns unsigned escrow CBOR |
| POST | `/api/listings/:id/escrow-confirm` | Submit signed escrow CBOR |
| POST | `/api/listings/:id/buy` | Buy (operator-signed, no buyer key needed) |
| GET | `/api/listings/:id/cancel-tx` | Get unsigned cancel CBOR for seller to sign |
| POST | `/api/listings/:id/cancel` | Submit seller-signed cancel CBOR |

### Admin (`X-Admin-Key` header required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/events` | Recent hydra_events (filterable by tag) |
| GET | `/api/admin/tx-submissions` | All tx submissions |
| GET | `/api/admin/stats` | Aggregate counts (listings, sales, events) |
| POST | `/api/admin/head/close` | Send Close command to Hydra node |
| POST | `/api/admin/head/fanout` | Send Fanout command |

---

## 8. How to Run

### Prerequisites

```bash
# All commands run inside WSL Ubuntu-24.04
# Cardano node must be synced to preprod

# Binaries expected at:
/home/rodrigo/workspace/hydra_test/bin/cardano-cli
/home/rodrigo/workspace/hydra_test/hydra-bin/hydra-node
/home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
```

### 1. Start PostgreSQL

```bash
sudo service postgresql start
# DB: postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace
# (create once: createdb marketplace && psql -c "CREATE USER marketplace WITH PASSWORD 'marketplace'; GRANT ALL ON DATABASE marketplace TO marketplace;")
```

### 2. Start Hydra node

```bash
cd /home/rodrigo/hydra-nft-marketplace
make hydra-start          # starts in tmux session 'hydra-marketplace'
make hydra-init           # sends Init command → HeadIsInitializing
# then commit ADA from L1 (must be done from each participant)
bash hydra/scripts/commit.sh
# once all parties committed → HeadIsOpen
```

### 3. Start backend

```bash
make backend
# or: cd backend && npm run dev
# API on http://127.0.0.1:3000
```

### 4. Start frontend

```bash
make frontend
# or: cd frontend && npm run dev -- --port 3001
# UI on http://localhost:3001
# Next.js rewrites /api/* → http://localhost:3000/api/*
```

### Environment variables (`backend/.env`)

```bash
HYDRA_WS_URL=ws://127.0.0.1:4001
HYDRA_HTTP_URL=http://127.0.0.1:4001
DATABASE_URL=postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace
PORT=3000
CARDANO_CLI_PATH=/home/rodrigo/workspace/hydra_test/bin/cardano-cli
SKEY_PATH=/home/rodrigo/workspace/hydra_test/keys/cardano.skey
TESTNET_MAGIC=1
SCRIPT_ADDRESS=addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm
SCRIPT_CBOR=<double-CBOR from applyCborEncoding(plutus.json compiledCode)>
TX_FEE=0                  # 0 = zero-fee Head; set to 165633 for standard params
ADMIN_SECRET=changeme
```

---

## 9. Testing

### 9.1 On-chain unit tests (Aiken)

```bash
cd contracts
aiken check          # runs all 14 tests
aiken check -m buy   # filter by pattern
aiken build          # recompile → updates plutus.json
```

All 14 tests pass. Tests cover valid and invalid Buy/Cancel paths with explicit `fail` expectations.

### 9.2 E2E test suite

Located in `e2e/`. Uses `tsx` to run TypeScript directly, `cardano-cli` for offline signing, and the live HTTP API.

#### Infrastructure checks only (no NFT needed, just running stack)

```bash
make e2e-infra
# or: cd e2e && E2E_POLICY_ID= E2E_ASSET_NAME= npx tsx test.ts
```

This checks:
1. `GET /api/health` returns `ok: true` (DB + Hydra connected)
2. `GET /api/head/status` shows `status: open`
3. `GET /api/listings` returns valid shape
4. `GET /api/admin/stats` with correct `X-Admin-Key` header

#### Full flow tests (requires a real NFT inside the Hydra Head)

```bash
E2E_POLICY_ID=<56-char hex> E2E_ASSET_NAME=<hex> make e2e
```

This runs two additional flows:
- **List + Buy:** create listing → sign escrow tx (cardano-cli) → confirm → buy → assert `sold`
- **List + Cancel:** create listing → sign escrow → confirm → fetch unsigned cancel tx → sign → submit → assert `cancelled`

The test NFT (`E2E_POLICY_ID` + `E2E_ASSET_NAME`) must be present as a UTxO in the Hydra Head snapshot under `E2E_SELLER_ADDRESS` (defaults to `addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8`).

#### E2E env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_API_BASE` | `http://127.0.0.1:3000/api` | Backend URL |
| `E2E_ADMIN_KEY` | `changeme` | Must match `ADMIN_SECRET` |
| `E2E_CARDANO_CLI` | `/home/rodrigo/workspace/hydra_test/bin/cardano-cli` | CLI path |
| `E2E_SKEY_PATH` | `/home/rodrigo/hydra-nft-marketplace/hydra/keys/cardano.skey` | Signing key |
| `E2E_SELLER_ADDRESS` | `addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8` | |
| `E2E_POLICY_ID` | *(empty)* | Set to enable flow tests |
| `E2E_ASSET_NAME` | *(empty)* | hex asset name |
| `E2E_PRICE_ADA` | `2` | Price in ADA for the test listing |

#### Signing mechanics in E2E

The `signTx()` helper in `e2e/helpers.ts`:
1. Writes unsigned CBOR to a temp file as a cardano-cli envelope: `{"type":"Tx ConwayEra","description":"","cborHex":"..."}`
2. Calls `cardano-cli latest transaction sign --tx-file ... --signing-key-file ... --out-file ...`
3. Reads the signed envelope and returns the `cborHex`
4. Cleans up temp files

### 9.3 Manual testing with curl

```bash
# Health
curl http://localhost:3000/api/health | jq

# Head status
curl http://localhost:3000/api/head/status | jq

# List active listings
curl http://localhost:3000/api/listings?status=active | jq

# Admin stats
curl -H "X-Admin-Key: changeme" http://localhost:3000/api/admin/stats | jq

# Admin events (last 10 TxValid)
curl -H "X-Admin-Key: changeme" "http://localhost:3000/api/admin/events?tag=TxValid&limit=10" | jq

# Create listing
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -d '{"requestId":"test-001","sellerAddress":"addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8","policyId":"<hex>","assetName":"<hex>","priceLovelace":"5000000"}' | jq
```

---

## 10. Known Limitations

1. **Single-party Head.** The current setup runs a single-node Hydra Head (both participants are the same key). A real marketplace needs at least 2 participants (seller + marketplace operator). Hydra v1.2.0 supports multi-party Heads.

2. **Operator-funded collateral.** The buy tx uses the operator's UTxO as Plutus collateral. If the operator runs low on small UTxOs inside the Head, buys will fail. Mitigation: periodically commit fresh pure-ADA UTxOs to the Head.

3. **No NFT metadata.** The `assets` table exists but is never populated automatically. Metadata display (image, display name) requires an off-chain metadata indexer or manual seeding.

4. **No buyer wallet integration.** The frontend buy modal asks for the buyer's Cardano address but does not connect to a browser wallet (CIP-30). The backend signs the buy tx using the operator key. For production, buyer UTxO selection could be done client-side with Eternl/Nami.

5. **In-memory idempotency store.** `IdempotencyStore` is in-process memory. On backend restart, duplicate request protection is lost. For production, move to a Redis or DB-backed store.

6. **Zero-fee Head only.** `TX_FEE=0` works only when the Hydra node was started with `protocol-parameters-zero-fees.json`. If it was started with standard params, set `TX_FEE=165633` (approximate minimum for these txs).

7. **E2E flow tests block waiting for Hydra confirmation.** The `sleep(3000)` calls are best-effort waits. On a slow machine or congested network, they may need to be increased. A proper fix would poll `GET /api/listings/:id` until `status !== 'draft'`.

---

## 11. What I Learned

### Hydra protocol specifics

- `Greetings` is emitted on every WS connect/reconnect and contains the current `headStatus` and `hydraHeadId`. This is the correct place to recover state on backend restart, not `HeadIsOpen` (which isn't re-emitted on reconnect).
- `SnapshotConfirmed.snapshot.confirmedTransactions` is an array of tx IDs (not CBORs) that were included in that snapshot. It is the reliable catch-up mechanism — `TxValid` can be missed if the backend restarts between submission and confirmation.
- `TxInvalid` contains the full tx CBOR in `transaction.cborHex` — useful for debugging.
- Hydra's HTTP `GET /snapshot/utxo` returns the latest confirmed UTxO set. It's safe to call any time and is the ground truth after a restart.

### Cardano CLI v10 breaking change

`cardano-cli latest transaction txid` now returns `{"txhash":"..."}` (JSON object) instead of a plain hex string. All code that calls txid must handle both formats with a try/catch.

### Aiken stdlib v3 API

- `cardano/assets.add` is a 4-argument function: `add(self, policy_id, asset_name, qty)` — not 2-argument.
- `cardano/address.VerificationKey(vkh)` — not `VerificationKeyCredential`.
- Multi-line expressions inside record literals can confuse the parser — extract to `let` bindings.
- `fail` tests use the `test foo() fail { ... }` syntax where the body must evaluate to `False` (or panic) for the test to pass.

### Express v5 + TypeScript

`@types/express` v5 types route params as `string | string[]`. Use `req.params["id"] as string` rather than `req.params.id!`.

### Seller-funded escrow insight

The naive "buyer pays at buy time" model doesn't work cleanly inside a Hydra Head when the operator signs buy transactions (the operator can't spend a UTxO they don't own). The seller-funded escrow model sidesteps this entirely: the escrow UTxO already contains all the ADA that needs to flow (to seller + min-ADA back to buyer), so the operator can build and sign the buy tx without any buyer UTxO.

### State machine discipline

The `listing_status` ENUM (`draft → active → sold/cancelled/failed`) with PostgreSQL partial unique indexes enforces invariants at the DB level. Only one active listing per NFT unit. The `tx_submissions` table as an audit log linking txs to actions is essential for the `TxInvalid` handler to correctly revert state without guessing.

### Next.js 14 App Router + server components

Server components fetch data directly (no `useEffect`) and use `export const revalidate = N` for ISR (incremental static regeneration). Interactive modals must be `"use client"` components. The pattern used throughout: server component renders static data + imports a client component for the interactive part (buy modal, cancel modal). Rewrites in `next.config.js` proxy `/api/*` to the backend on port 3000 — the frontend never directly calls `localhost:3000`, which means the same rewrite works in Docker too.

### cardano-cli datum encoding for inline datums

Plutus inline datums in `cardano-cli build-raw` use `--tx-out-inline-datum-value` with a detailed-schema JSON object:
```json
{"constructor": 0, "fields": [{"bytes": "<seller_vkh>"}, {"bytes": "<policy>"}, {"bytes": "<asset_name>"}, {"int": <price>}]}
```
The field order must exactly match the Aiken `ListingDatum` field order. A mismatch is silent at tx-build time but the validator will reject with a datum decode error at spend time.

### Redeemer encoding for Plutus script spending

For the `Buy` redeemer (`ListingAction { Buy { buyer } }`):
```json
{"constructor": 0, "fields": [{"bytes": "<buyer_vkh>"}]}
```
For `Cancel`:
```json
{"constructor": 1, "fields": []}
```
These are passed via `--tx-in-redeemer-value` in `cardano-cli build-raw`. Without `--tx-in-collateral` the CLI will error before even reaching the node.

### Hydra event ordering guarantee

Hydra events carry a monotonically increasing `seq` field. The backend persists every event with its `seq` into `hydra_events`. If seq gaps appear after a reconnect, the missing events can be reconstructed from the `SnapshotConfirmed` catch-up path. In practice, the UTxO set in `SnapshotConfirmed.snapshot.utxo` is sufficient to reconcile all listing states without replaying individual txs.

---

## 12. Project State at Handoff

### What is complete and tested

- Full listing lifecycle (create → escrow → active → buy/cancel) — implemented, typecheck clean
- Aiken contract — 14 unit tests, all pass with `aiken check`
- DB migrations — auto-run on startup via `migrate()`
- State sync — `SnapshotConfirmed` catch-up + `Greetings` session recovery
- Admin API — stats, events, close/fanout commands
- Frontend — all 5 pages + components, `tsc --noEmit` clean
- E2E suite — infrastructure checks run without a Head; flow tests run with a real NFT

### What has NOT been run end-to-end yet

The full **list → buy** and **list → cancel** E2E flows (`make e2e`) have not been executed against a live Head with a real NFT. The blockers are:

1. The Hydra Head needs to be open (requires a running cardano-node synced to preprod + hydra-node + `make hydra-init` + `make commit`)
2. A test NFT (minted on preprod) must exist as a UTxO inside the Head under the seller address `addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8`
3. `E2E_POLICY_ID` and `E2E_ASSET_NAME` must be set

Infrastructure checks (`make e2e-infra`) can be run as soon as the backend is up with a connected Hydra node (Head does not need to be open for health + listings + stats endpoints).

### Derived contract values

These were computed once from `contracts/plutus.json` and are stored in `backend/.env`:

| Value | Data |
|-------|------|
| Script hash | `8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc` |
| Script address | `addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm` |
| Operator address | `addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8` |

If the contract is recompiled (any validator change), both `SCRIPT_ADDRESS` and `SCRIPT_CBOR` in `.env` must be updated. The easiest way:

```bash
cd contracts && aiken build
# read compiledCode from plutus.json
# wrap with applyCborEncoding() (MeshSDK) to get double-CBOR for SCRIPT_CBOR
# recompute address with serializePlutusScript()
```

---

## 13. Immediate Next Steps (if continuing development)

1. **Run with a real NFT** — mint a test NFT on preprod, commit it into the Head, run `make e2e` to get the first green end-to-end run.

2. **Replace `sleep(3000)` in E2E** with polling: `GET /api/listings/:id` until `status !== 'draft'`, with a timeout. This makes the tests deterministic regardless of Hydra confirmation latency.

3. **Multi-party Head** — currently the Head has one participant. A realistic marketplace needs: participant A (seller/buyer wallets) + participant B (marketplace operator). This requires running two hydra-nodes and updating `start.sh` with `--peer` and `--hydra-verification-key` for each party.

4. **CIP-30 wallet integration** — connect Eternl/Nami in the frontend so sellers can sign the escrow tx directly in the browser instead of pasting CBOR manually.

5. **NFT metadata indexer** — populate the `assets` table from an off-chain indexer (Blockfrost asset metadata API) so listing cards show NFT images and display names.

6. **Collateral management** — add a background job that ensures the operator always has at least 3 pure-ADA UTxOs ≥ 5 ADA inside the Head. Alert (or auto-commit) if the supply drops.

7. **Containerise** — add a `docker-compose.yml` that brings up PostgreSQL + backend + frontend. The Hydra node and cardano-node remain external (they need the real socket).

---

## 15. Post-Launch Changes (2026-03-28)

### Farmer-friendly sell form

The sell form (`frontend/app/sell/SellForm.tsx`) was updated to remove all hex fields from the user interface:

**Before:**
- Policy ID (hex, 56 chars)
- Asset Name (hex)
- Price (ADA)

**After:**
- Nombre del cultivo (plain text — e.g. "Arroz", "Soja", "Maíz")
- ID del token (Policy ID — still required, labeled in plain language)
- Precio (ADA)

The asset name is converted to UTF-8 hex internally before being sent to the backend. The farmer never sees hex.

### Migration fix (002_production_indexes.sql)

The `tx_submissions_pending` index was referencing `created_at` which does not exist on `tx_submissions` (the column is `submitted_at`). Fixed the migration.

---

## 14. Quick-Start Checklist (re-opening the project)

```
[ ] sudo service postgresql start
[ ] Verify cardano-node socket: ls /home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
[ ] cd /home/rodrigo/hydra-nft-marketplace && make hydra-start
[ ] Wait for Greetings event: tmux attach -t hydra-marketplace
[ ] If head not open: make hydra-init  →  bash hydra/scripts/commit.sh
[ ] make backend          (new terminal, wait for "API server listening")
[ ] make frontend         (new terminal, wait for "Ready on http://localhost:3001")
[ ] curl http://localhost:3000/api/health | jq   →  should show ok:true
[ ] make e2e-infra        (4 infrastructure tests should pass)
[ ] open http://localhost:3001
```
