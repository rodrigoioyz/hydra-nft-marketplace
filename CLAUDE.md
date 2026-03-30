# CLAUDE.md — Hydra NFT Marketplace

This file is read automatically by Claude Code at the start of every session.
**Read `docs/dev-report.md` for the full build log, bug history, and operational state.**

---

## Project summary

Fixed-price marketplace for agricultural crop tokens. All trades execute inside a **Hydra Head** (Cardano L2). Farmers register with KYC (FarmerPass NFT on L1), mint fungible CropTokens on L1, commit them into the Head, and trade inside the Head.

**Stack:** Aiken v1.1.19 · cardano-cli 10.x · Hydra v1.2.0 · TypeScript/Express · PostgreSQL · Next.js 14
**Network:** Cardano preprod (testnet-magic 1)
**Last updated:** 2026-03-29

---

## Current state (2026-03-29)

- Hydra Head is **Open** on preprod
- Active listings: Soja pepito, Lentejas pepito (at listing script address)
- Backend running on port 3000, frontend on port 3001
- All core flows working: list, buy, cancel, commit, farmer KYC

### Running processes

| Process | tmux session | Port |
|---------|--------------|------|
| cardano-node | (background) | 6000 |
| hydra-node | hydra-marketplace | 4001 |
| backend (tsx) | hydra-backend | 3000 |
| frontend (next dev) | hydra-frontend | 3001 |

---

## Critical: things that will bite you if you don't know them

### 1. Hydra v1.2.0 `TxValid` event has NO `transaction` object

`TxValid` sends `transactionId` as a **top-level field**:
```json
{ "tag": "TxValid", "transactionId": "abc123...", "headId": "...", "seq": 5 }
```
There is NO `transaction.id`. We verified this against `hydra-node/json-schemas/api.yaml`.
Our types/code are already fixed (`types/hydra.ts`, `hydra/client.ts`, `db/eventStore.ts`).
Do NOT revert to `event.transaction?.id`.

### 2. Incremental deposits (Hydra `POST /commit` while Open) are BROKEN

Deposit tx confirms on L1 but Hydra never emits `CommitRecorded`. `GET /commits` always returns `[]`.
**Use classic commit only** (commit UTxOs before `Collect`, while Head is `Initializing`).

### 3. Buy flow requires 2 pure-ADA UTxOs in the Head

The escrow UTxO holds only token + minADA. The buy tx needs:
- UTxO 1 → buyer input (funds the seller payment)
- UTxO 2 → collateral

Use `POST /api/head/split-ada` immediately after opening the Head.

### 4. UTxOs inside the Head are NOT visible on L1

CIP-30 wallets cannot verify UTxOs that are only inside the Hydra Head.
For the escrow tx, we declare the seller's key as `--required-signer-hash` in cardano-cli so the wallet will sign without needing to see the UTxO on L1.

### 5. `asset_name` is stored as hex in the DB

`asset_name` column contains hex-encoded UTF-8 (e.g. `536f6a612070657069746f` = "Soja pepito").
Use `hexToUtf8()` helper in `listings.ts`. The API returns a `displayName` field (decoded or null).

### 6. Init tx sibling UTxO cannot be committed

The UTxO produced by the Init transaction at the operator's address (`0523c562...#2`) **cannot be committed** to the Head — it triggers `NotEnoughFuel`. It can only be used as L1 fuel.

---

## Key file locations

```
backend/src/api/listings.ts       — listing lifecycle (create, escrow-confirm, buy, cancel)
backend/src/api/head.ts           — init, collect, split-ada, status
backend/src/api/farmers.ts        — KYC, CropToken mint, build-commit-tx
backend/src/hydra/client.ts       — WebSocket client, awaitTxConfirmation
backend/src/tx/cli.ts             — cardano-cli builder (escrow, buy, cancel, transfer)
backend/src/types/hydra.ts        — Hydra event types (VERIFIED against v1.2.0 schema)
backend/src/db/eventStore.ts      — Hydra event → DB projections
contracts/validators/listing.ak   — spend validator: Buy | Cancel
contracts/validators/farmer_pass.ak
contracts/validators/crop_token.ak
frontend/app/sell/SellForm.tsx    — commit + list + sign flow
```

---

## Known preprod values

```
Listing script hash:    8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc
Listing script address: addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm
CropToken policy ID:    111da6625fa277baf894d3c16f799349a44cd8713e55ac7c3c950c4d

Operator address: addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8
Pepito address:   addr_test1qrgff35ks084ej5va4y2cc88092rfcgcdwr4zjtcq238sv9edtserxw9vp4fe9a86wl9r3vm7nu6gw0z8z96akylkm6sy6xm6t

cardano-cli:  /home/rodrigo/workspace/hydra_test/bin/cardano-cli
hydra-node:   /home/rodrigo/workspace/hydra_test/hydra-bin/hydra-node
node socket:  /home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
operator key: /home/rodrigo/hydra-nft-marketplace/hydra/keys/cardano.skey
```

---

## Aiken contracts

```bash
cd contracts
aiken check   # 26/26 tests pass
aiken build   # → plutus.json
```

`listing.ak` — `Buy { buyer }`: seller receives price, buyer receives token (`quantity >= 1`).
`Cancel`: seller signature required, token returned.
**No `Update` redeemer exists.**

---

## DB schema (key tables)

```
listings        — draft → active → sold/cancelled; escrow_tx_hash, escrow_utxo_ix
sales           — confirmed purchases; hydra_tx_id
tx_submissions  — audit log; request_id for idempotency
hydra_events    — raw WS event log
head_sessions   — one row per Hydra Head session
farmer_registrations — KYC; pending → approved/rejected
crop_mints      — crop lot records
```

---

## API quick reference

```
POST /api/head/init              — send Init command
POST /api/head/collect           — send Collect, await HeadIsOpen
POST /api/head/split-ada         — split operator ADA into 2 UTxOs
GET  /api/head/status            — current head status
GET  /api/head/utxos             — live Hydra snapshot

POST /api/listings               — create draft → returns unsigned escrow CBOR
POST /api/listings/:id/escrow-confirm — submit signed CBOR → activate listing
POST /api/listings/:id/buy       — operator-signed buy tx
GET  /api/listings/:id/cancel-tx — unsigned cancel CBOR
POST /api/listings/:id/cancel    — submit signed cancel CBOR

POST /api/crops/build-commit-tx  — combined commit (operator pre-signs, farmer adds witness)
POST /api/crops/submit-commit-tx — submit to L1
POST /api/crops/build-mint-tx    — unsigned L1 CropToken mint tx
```

---

## Known gaps / incomplete work

| Item | Notes |
|------|-------|
| Portfolio page | Not implemented |
| DB reconciliation | No auto DB↔Hydra snapshot reconciliation — orphaned UTxOs need manual SQL |
| FarmerPass auto-mint | Operator pastes tx hash manually into admin panel |
| Head session cleanup | `head_sessions` row not updated to `closed` on `HeadIsFinalized` |
| TxInvalid txId matching | Uses `event.transaction?.txId` (optional field) — needs live verification |
| Multi-party Head | Single-participant only; real deployment needs 2+ nodes |

---

## Full documentation

- `docs/dev-report.md` — **full build log, all bugs, operational state** ← start here
- `docs/tickets.md` — epic/ticket backlog with ✅/🔧/⬜ status
- `docs/architecture.md` — system architecture + Hydra v1.2.0 API notes
- `docs/spec-validator.md` — Aiken validator spec
- `docs/spec-api.md` — REST API spec
- `docs/spec-database.md` — DB schema spec
