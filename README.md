# Hydra NFT Marketplace — Agricultural Crop Tokens on Cardano L2

A production-ready marketplace where **farmers tokenize their harvests and trade them instantly** — without paying per-transaction fees. Built on Cardano's Layer 2 scaling protocol (Hydra Head), the entire trading experience is designed so the infrastructure is invisible: users see a marketplace, not a blockchain.

**Stack:** Aiken v1.1.19 · cardano-cli 10.x · Hydra v1.3.0 · TypeScript/Express · PostgreSQL · Next.js 14
**Network:** Cardano preprod (testnet-magic 1)

---

## The Problem We're Solving

Cardano's base layer (Layer 1) is secure and decentralized, but every transaction costs ADA fees and takes 20–60 seconds to confirm. For a marketplace where farmers trade fractional crop tokens in small quantities, those economics don't work — a farmer shouldn't pay the same per-trade fee whether they sell 1 kg or 1,000 kg of soy.

**Hydra Head** solves this: it's a parallel "channel" between known participants where transactions confirm in milliseconds and fees approach zero. The final state settles back on the main chain later.

The challenge: Hydra's native interface is complex — "commit UTxOs", "open the Head", "snapshots", "fanout". A farmer who wants to sell their harvest shouldn't need to understand any of that.

**Our solution:** Hide all of it. The user sees _Publish → Sell → Done_. The infrastructure is invisible.

---

## For Non-Developers: What This Does

Imagine a farmers' market on the internet, but with three properties normal markets don't have:

1. **Instant settlement:** When a buyer clicks "Buy", the seller receives payment immediately — no waiting, no bank transfer delays.

2. **Near-zero fees:** Trades happen inside a Layer 2 channel. Instead of paying a blockchain fee on every single trade, participants pay only to enter and exit the channel (two L1 transactions total, regardless of how many trades happen inside).

3. **Cryptographic guarantees:** The rules of the marketplace are enforced by code on the blockchain. No one can take your money without delivering the tokens, and no one can take tokens without paying. The operator cannot steal funds — the smart contract prevents it.

### The user journey

**For a farmer (seller):**
1. Register with privacy-preserving identity verification → receive a **FarmerPass NFT** (one-time, on-chain)
2. Mint crop tokens representing their harvest → e.g., "500 kg Soja Pepito"
3. Deposit tokens into the marketplace → tokens move from their wallet to the trading channel
4. Publish a listing with a price in ADA
5. Wait for a buyer → receive ADA instantly when sold

**For a buyer:**
1. Browse listings — all active offers visible in real time
2. Click "Buy" → confirm in their wallet
3. Tokens arrive instantly

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cardano L1 (preprod)                     │
│                                                                   │
│   Farmer wallet     Operator wallet      Script address           │
│   (ADA + tokens)    (ADA collateral)    (Aiken validator)         │
│          │                  │                    │                 │
│          └──────────────────┴────── Hydra Head ──┘                │
│                                    (L2 channel)                   │
└─────────────────────────────────────────────────────────────────┘

Inside the Hydra Head:
  - Listings live as UTxOs locked at the Aiken script address
  - Buy txs unlock the UTxO → ADA to seller, tokens to buyer
  - Cancel txs unlock the UTxO → tokens back to seller
  - All of this happens in <1 second
```

### Components

| Component | What it does |
|---|---|
| **Aiken contracts** | On-chain rules: who can buy (anyone who pays), who can cancel (only seller), proof of ownership |
| **Hydra node** | The L2 protocol engine — manages the Head lifecycle, validates txs, maintains snapshots |
| **Backend (Express)** | Builds transactions, talks to the Hydra node via WebSocket, persists state to PostgreSQL |
| **PostgreSQL** | Stores listings, sales, farmer KYC status, Hydra event log |
| **Frontend (Next.js)** | User interface — connects CIP-30 wallets (Eternl, Nami), real-time listing updates via SSE |

---

## Smart Contracts

Three Aiken validators in `contracts/validators/`:

### `listing.ak` — the escrow (L2)

Every listing is a UTxO locked at this script. The datum records: seller address, token policy, token name, price in lovelace.

| Action | Who | Rule enforced on-chain |
|---|---|---|
| **Buy** | Anyone | Seller must receive exactly `datum.price` lovelace; buyer receives the token |
| **Cancel** | Seller only | Transaction must be signed by the seller's key |

This means: even if the operator's backend were compromised, an attacker still cannot steal funds — they would need the seller's private key to cancel, and they cannot redirect the buyer payment without the seller's signature.

### `farmer_pass.ak` — identity NFT (L1)

One token per farmer, minted by the operator after KYC approval. Used to gate CropToken minting. Token name = the farmer's payment key hash (28 bytes), making it non-transferable in practice.

### `crop_token.ak` — harvest tokens (L1)

Fungible tokens representing physical harvests. Minting requires:
- Farmer's signature
- FarmerPass NFT in the transaction inputs

Burning requires farmer or operator signature (for emergency recovery).

### Test coverage

```bash
cd contracts
aiken check   # 26/26 tests pass
```

### Preprod deployment

```
Listing script hash:    8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc
Listing script address: addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm
CropToken policy ID:    111da6625fa277baf894d3c16f799349a44cd8713e55ac7c3c950c4d
Operator address:       addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8
Head ID:                d59f9af876aac5490673b2824481fd7a475c134e477a303784b02043
```

---

## Project Structure

```
hydra-nft-marketplace/
├── contracts/                  Aiken smart contracts
│   └── validators/
│       ├── listing.ak          escrow: Buy | Cancel
│       ├── farmer_pass.ak      identity NFT policy
│       └── crop_token.ak       harvest token policy
├── backend/src/
│   ├── api/
│   │   ├── listings.ts         listing lifecycle (create, escrow, buy, cancel, recover)
│   │   ├── farmers.ts          KYC, CropToken minting, stats
│   │   ├── wallet.ts           L1/L2 balance, deposit, withdraw, L1 submit
│   │   ├── head.ts             Head lifecycle (init, collect, split-ada, status)
│   │   ├── admin.ts            admin endpoints (approve KYC, close Head, fanout)
│   │   └── events.ts           SSE relay — pushes Hydra events to the browser
│   ├── hydra/client.ts         Hydra WebSocket client (reconnect, awaitTxConfirmation)
│   ├── tx/cli.ts               cardano-cli transaction builder
│   ├── tx/l1mint.ts            L1 mint helpers
│   ├── db/eventStore.ts        Hydra event → DB projection (listings, sales, tx_submissions)
│   ├── sync/stateRecovery.ts   On-restart reconciliation (DB vs Head snapshot)
│   └── types/hydra.ts          Hydra event types (v1.3.0)
├── frontend/
│   ├── app/
│   │   ├── page.tsx            Listings browse (SSE real-time, no polling)
│   │   ├── listings/[id]/      Listing detail + buy flow
│   │   ├── sell/               Publish a listing (wallet-signed escrow)
│   │   ├── portfolio/          L1 balance + marketplace balance, Deposit/Withdraw
│   │   ├── dashboard/          Farmer stats, active listings, recent sales
│   │   ├── identity/           KYC form + CropToken minting
│   │   └── status/             Head status (operator-facing)
│   ├── components/
│   │   ├── ToastProvider.tsx   SSE-driven global toast notifications
│   │   ├── ListingsGrid.tsx    Real-time listing grid
│   │   ├── Navbar.tsx          Navigation
│   │   └── WalletConnect.tsx   CIP-30 wallet picker
│   └── context/WalletContext.tsx  Global wallet state
├── hydra/
│   ├── keys/                   Operator keys (gitignored — never committed)
│   └── scripts/start.sh        hydra-node launch script (v1.3.0 preprod TX IDs)
├── e2e/test.ts                 End-to-end test suite
└── docs/
    ├── dev-report.md           Full build log, bugs, decisions
    ├── tickets.md              Epic/ticket backlog
    └── ux-roadmap.md           UX phases: problems diagnosed, solutions applied
```

---

## Key Engineering Decisions

### Decision 1 — Operator funds the escrow (not the buyer)

**Problem:** In a normal marketplace, the buyer deposits ADA first, then receives the token. But inside the Hydra Head, the operator is the only one who can build a valid buy transaction on behalf of the buyer — buyers sign via their browser wallet, which cannot construct a full Hydra transaction.

**Decision:** The escrow UTxO holds the token. When a buyer clicks "Buy", the operator builds the full transaction using one of its own ADA UTxOs inside the Head to fund the seller payment. The buyer's wallet only approves the final signed CBOR.

**Consequence:** The operator must always maintain a funded ADA UTxO inside the Head. This is why `POST /api/head/split-ada` exists — it splits the operator's committed ADA into two UTxOs (one as buyer-payment input, one as collateral). If the operator runs out of ADA inside the Head, buys will fail.

### Decision 2 — Two-step signing for seller operations

**Problem:** Sellers use browser wallets (Eternl, Nami). These wallets sign UTxOs visible on L1. But when a farmer has deposited their token into the Hydra Head, the token is no longer visible on L1 — the wallet may refuse to sign a transaction spending a UTxO it cannot see.

**Decision:** The backend builds the full unsigned CBOR and includes `--required-signer-hash <sellerVkh>`. This signals to the CIP-30 wallet that it should add its signature even without seeing the input UTxO on-chain. The wallet adds its witness; the frontend posts the signed CBOR back, which is then submitted to the Hydra node.

This pattern (`return unsigned CBOR → browser signs → post signed CBOR → backend submits`) is used for all seller operations (list, cancel) and for incremental deposits.

### Decision 3 — Incremental commits in Hydra v1.2.0 are broken

**Problem:** Hydra supports "incremental deposits" — a farmer should be able to deposit tokens into an already-open Head without closing it. We implemented this in the portfolio UI. It never worked: deposits confirmed on L1 but the Hydra node never emitted `CommitRecorded`.

**Root cause (discovered via Hydra source analysis):** A lifecycle math bug in the deposit handler. The deposit's `created` timestamp equals `t_max` of the depositTx block. Both the "Active" condition (`t > created + T_deposit`) and the "Expired" condition (`t > deadline - T_deposit`) resolve to the same block threshold. Because "Expired" is checked first in the tick handler, every deposit transitions directly Inactive → Expired, never entering the Active state. `CommitRecorded` is only emitted on the Active transition — so it never fires.

**Decision (v1.2.0 workaround):** Disable incremental deposits in the UI. Farmers commit before the Head opens via the classic commit flow.

**Fix in v1.3.0:** Hydra PRs #2491 and #2500 fix `pendingDeposits` tracking. We upgraded the binary and updated the three `--hydra-scripts-tx-id` values in `start.sh`. The "Deposit to marketplace" button in the portfolio UI is ready — pending Head re-initialization with v1.3.0 scripts to verify end-to-end.

### Decision 4 — UX hides all Hydra concepts

**Problem:** Early versions exposed the Head lifecycle in the UI:
- "Commit al Head" button
- "Abrir Head (Collect)" button
- "Dividir ADA" button
- Status badges: "Initializing / Open / Idle"

A farmer selling their harvest doesn't know what a Hydra Head is and shouldn't need to.

**Decision:** Eight UX phases were implemented to progressively hide all infrastructure:

| Phase | What was improved |
|---|---|
| 0 | Operator keeps the Head always open — users never see it open or close |
| 1 | Portfolio shows "in your wallet" vs "in the marketplace" — never "in the Head" |
| 2 | SellForm: select token → set price → sign → done (Commit/Collect buttons removed) |
| 3 | Progress messages in plain language: "Publishing…", "Confirming…", "Done!" |
| 4 | Real-time listing updates via SSE (replaced 5-second polling) |
| 5 | KYC form shows SLA estimate; auto-updates when admin approves via SSE |
| 6 | Stuck escrow recovery is dynamic — finds the user's own stuck UTxOs automatically |
| 7 | "Deposit to marketplace" / "Withdraw" buttons in Portfolio (v1.3.0) |
| 8 | Farmer Dashboard with stats + SSE-driven toast notifications |

No user-facing text mentions "Hydra", "Head", "L2", "UTxO", "lovelace", "commit", or "snapshot".

### Decision 5 — Server-Sent Events replace polling

**Problem:** The listings page used `revalidate: 5` (Next.js static regeneration every 5 seconds). Inside the Hydra Head, transactions confirm in ~1 second. The 5-second delay made the marketplace feel broken after a purchase.

**Decision:** The backend holds open SSE connections per browser client at `/api/events`. When the Hydra WebSocket fires `TxValid` or `SnapshotConfirmed`, the backend relays a lightweight JSON event to all connected clients. The `ListingsGrid` component re-fetches on receipt. Latency from trade to UI update dropped from ~5s to ~2s.

The same SSE channel drives: toast notifications, KYC form auto-approval updates, and portfolio deposit/withdraw state changes.

### Decision 6 — Verifying the Hydra TxValid event shape against the source schema

**Problem:** Our `awaitTxConfirmation` was always timing out (30 second timeout, every time), making every buy and list operation fail with a 502.

**Root cause:** We assumed the `TxValid` event had shape `{ transaction: { id: "..." } }`. The actual Hydra v1.2.0 event shape (verified against the official OpenAPI schema at `hydra-node/json-schemas/api.yaml`) is `{ transactionId: "...", headId: "...", seq: N }` — `transactionId` is top-level, no `transaction` wrapper. Our check always evaluated `undefined === txId`.

**Fix:** Updated `types/hydra.ts` and `awaitTxConfirmation` in `client.ts`. The function now resolves immediately on the first matching `TxValid` event.

**Lesson:** When integrating with any protocol that doesn't have TypeScript types in its SDK, always verify event shapes against the source schema — don't trust sample logs or documentation alone.

---

## Bugs Fixed

| Bug | Symptom | Root Cause | Fix |
|---|---|---|---|
| **BUG-001** | `awaitTxConfirmation` always timed out (30s) | `TxValid` sends `transactionId` top-level, not `transaction.id` | Updated event type + matching logic in `client.ts` |
| **BUG-002** | `insufficient_funds` on buy | Operator's single ADA UTxO (20 ADA) < listing price (25 ADA) | Merged UTxOs inside Head via raw Hydra tx; now always split ADA after opening |
| **BUG-003** | 502 after snapshot fallback | Consequence of BUG-001; confirm endpoints always hit 30s timeout | Added snapshot-polling fallback; root-fixed by BUG-001 |
| **BUG-004** | Token names showed as hex in UI | `asset_name` stored as hex (`536f6a612070657069746f`); raw hex displayed | Added `hexToUtf8` + `displayName` field in listings API |
| **BUG-005** | CIP-30 wallet refused to sign escrow tx | `--required-signer-hash` missing; wallet wouldn't sign UTxOs not visible on L1 | Added `--required-signer-hash ${sellerVkh}` to tx builder |

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [cardano-node](https://github.com/IntersectMBO/cardano-node) | 10.x | synced to preprod |
| [cardano-cli](https://github.com/IntersectMBO/cardano-cli) | 10.x | |
| [hydra-node](https://github.com/cardano-scaling/hydra/releases) | **1.3.0** | `hydra-x86_64-linux-1.3.0.zip` |
| [aiken](https://aiken-lang.org/installation-instructions) | 1.1.x | contract compilation |
| Node.js | 20+ | |
| PostgreSQL | 15+ | |

All commands assume WSL Ubuntu-24.04 on Cardano preprod.

---

### Step 1 — Generate operator keys

```bash
cardano-cli address key-gen \
  --normal-key \
  --signing-key-file  hydra/keys/cardano.skey \
  --verification-key-file hydra/keys/cardano.vkey

cardano-cli address build \
  --payment-verification-key-file hydra/keys/cardano.vkey \
  --testnet-magic 1 \
  --out-file hydra/keys/cardano.addr

hydra-node gen-hydra-key --output-file hydra/keys/hydra
```

> `hydra/keys/*.skey` and `*.sk` are gitignored. Back them up outside the repo. Fund `hydra/keys/cardano.addr` with at least **50 ADA** from the [preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/).

---

### Step 2 — Configure environment

```bash
cp backend/.env.example backend/.env
cp hydra/config/.env.example hydra/config/.env
```

Key variables in `backend/.env`:

```env
CARDANO_CLI_PATH=/path/to/cardano-cli
SKEY_PATH=/path/to/hydra/keys/cardano.skey
CARDANO_NODE_SOCKET_PATH=/path/to/node.socket
OPERATOR_ADDRESS=addr_test1v...
SCRIPT_ADDRESS=addr_test1w...       # derived after compiling contracts
SCRIPT_CBOR=...                     # double-CBOR encoded script
PROTOCOL_PARAMS_PATH=/path/to/protocol-parameters.json
ADMIN_API_KEY=your-secret-key
BLOCKFROST_API_KEY=preprodXXX...
```

---

### Step 3 — Database setup

```bash
psql -U postgres -c "CREATE USER marketplace WITH PASSWORD 'marketplace';"
psql -U postgres -c "CREATE DATABASE marketplace OWNER marketplace;"
cd backend && npx tsx src/db/migrate.ts
```

---

### Step 4 — Compile contracts

```bash
cd contracts
aiken build   # → plutus.json
aiken check   # all tests must pass
```

The `compiledCode` in `plutus.json` is single-CBOR. The backend needs double-CBOR:

```bash
node -e "
const raw = require('./contracts/plutus.json').validators[0].compiledCode;
const len = raw.length / 2;
const prefix = len <= 0x17   ? (0x40 + len).toString(16).padStart(2,'0')
             : len <= 0xff   ? '58' + len.toString(16).padStart(2,'0')
             : len <= 0xffff ? '59' + len.toString(16).padStart(4,'0')
             :                 '5a' + len.toString(16).padStart(8,'0');
console.log(prefix + raw);
"
```

To derive `SCRIPT_ADDRESS`:

```bash
echo '{"type":"PlutusScriptV3","description":"","cborHex":"<SCRIPT_CBOR>"}' > /tmp/listing.plutus
cardano-cli latest address build \
  --payment-script-file /tmp/listing.plutus \
  --testnet-magic 1
```

---

### Step 5 — Install and start

```bash
cd backend  && npm install
cd ../frontend && npm install

# Backend
tmux new-session -d -s backend \
  'cd /home/rodrigo/hydra-nft-marketplace/backend && npx tsx src/index.ts'

# Frontend (port 3001)
tmux new-session -d -s frontend \
  'cd /home/rodrigo/hydra-nft-marketplace/frontend && npm run dev -- --port 3001'

# Hydra node
./hydra/scripts/start.sh

# Verify
curl http://localhost:3000/api/health | jq
```

**WSL2 port forwarding** (run PowerShell as Administrator; redo after each WSL restart):

```powershell
$wsl = (wsl -d Ubuntu-24.04 -- hostname -I).Trim().Split()[0]
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$wsl
netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=$wsl
```

---

### Step 6 — Open the Hydra Head (one-time)

```bash
# 1. Initialize
curl -X POST http://localhost:3000/api/head/init

# 2. Operator commits ADA (classic commit, before Collect)
./hydra/scripts/commit-op.sh

# 3. Open Head (wait ~30s for HeadIsOpen)
curl -X POST http://localhost:3000/api/head/collect

# 4. Split operator ADA — required for buy flow
curl -X POST http://localhost:3000/api/head/split-ada
```

To close and re-initialize (e.g., after a Hydra binary upgrade):

```bash
curl -X POST http://localhost:3000/api/admin/head/close \
  -H "x-admin-key: $ADMIN_API_KEY"
# Wait 10 minutes (contestation period)
curl -X POST http://localhost:3000/api/admin/head/fanout \
  -H "x-admin-key: $ADMIN_API_KEY"
# Then redo init → commit → collect
```

---

## API Summary

Full spec at `docs/spec-api.md`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service health |
| `GET` | `/api/listings` | All active listings |
| `POST` | `/api/listings` | Create listing (draft) |
| `POST` | `/api/listings/:id/escrow` | Get unsigned escrow CBOR |
| `POST` | `/api/listings/:id/escrow-confirm` | Submit signed escrow CBOR |
| `POST` | `/api/listings/:id/buy` | Execute purchase |
| `GET` | `/api/listings/:id/cancel-tx` | Get unsigned cancel CBOR |
| `POST` | `/api/listings/:id/cancel` | Submit signed cancel CBOR |
| `GET` | `/api/listings/my-escrows/:address` | Seller's stuck escrows |
| `GET` | `/api/wallet/balance/:address` | UTxOs inside the Head |
| `GET` | `/api/wallet/l1-balance/:address` | UTxOs on L1 (Blockfrost) |
| `POST` | `/api/wallet/deposit` | Build incremental commit tx (v1.3.0) |
| `POST` | `/api/wallet/submit-l1-tx` | Submit signed tx to Blockfrost |
| `POST` | `/api/wallet/withdraw` | Decommit a Head UTxO |
| `GET` | `/api/farmers/stats/:address` | Farmer dashboard stats |
| `GET` | `/api/events` | SSE stream (real-time events) |
| `GET` | `/api/head/status` | Head lifecycle state |
| `POST` | `/api/admin/farmers/:id/approve` | Approve KYC (`x-admin-key` required) |
| `POST` | `/api/admin/head/close` | Initiate Head close (`x-admin-key` required) |
| `POST` | `/api/admin/head/fanout` | Trigger fanout (`x-admin-key` required) |

---

## Running Tests

```bash
# Contract unit tests
cd contracts && aiken check

# Backend typecheck
cd backend && npx tsc --noEmit

# Frontend typecheck
cd frontend && npx tsc --noEmit

# End-to-end (requires running backend + open Head + funded test NFT)
cd e2e
E2E_POLICY_ID=<policy> E2E_ASSET_NAME=<hex_name> npx tsx test.ts
```

E2E tests cover: health check, Head status, listing browse, admin stats, list+buy flow, list+cancel flow.

---

## Current State (preprod, 2026-03-30)

| Item | Status |
|---|---|
| Hydra node | v1.3.0-7ccf541 (upgraded from v1.2.0) |
| Head | Open since 2026-03-30 01:55 UTC (v1.2.0 scripts) |
| Head re-init with v1.3.0 scripts | ⏳ Pending — requires closing current Head |
| Incremental commit ("Deposit" button) | ⏳ Pending Head re-init |
| Aiken contracts | Deployed to preprod, 26/26 tests pass |
| Farmer KYC + CropToken mint | Working |
| List / Buy / Cancel flows | Working |
| Real-time SSE updates | Working |
| Portfolio + Dashboard + Toasts | Working |

---

## Documentation

- [`docs/dev-report.md`](docs/dev-report.md) — complete build log: every session, every bug, every fix
- [`docs/tickets.md`](docs/tickets.md) — epic/ticket backlog with ✅/🔧/⬜ status
- [`docs/ux-roadmap.md`](docs/ux-roadmap.md) — UX problems diagnosed and 8-phase roadmap to hide Hydra
- [`docs/architecture.md`](docs/architecture.md) — system diagrams and data flow
- [`docs/spec-api.md`](docs/spec-api.md) — REST API full reference
- [`docs/spec-database.md`](docs/spec-database.md) — database schema

---

## License

MIT
