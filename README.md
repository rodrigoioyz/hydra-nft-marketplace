# Hydra NFT Marketplace

A fixed-price NFT marketplace on **Cardano** where trades happen inside a **Hydra Head** — Cardano's Layer 2 for instant, fee-free transactions.

---

## What is this?

On Cardano L1, every transaction takes ~20 seconds and costs a small fee. This project moves trading activity into a **Hydra Head** — a private payment channel where:

- Transactions confirm **instantly** (milliseconds)
- Fees are **zero** inside the Head
- Everything is secured by Cardano's cryptography

When trading is done, the final state settles back on-chain via fanout.

---

## How it works

```
Seller                         Operator (backend)               Buyer
  |                                    |                           |
  |-- Lists NFT ---------------------->|                           |
  |   (signs escrow tx inside Head)    |                           |
  |                                    |<-- Browse listings -------|
  |                                    |<-- Buy NFT ---------------|
  |                                    |   (instant Hydra tx)      |
  |<-- Receives ADA instantly ---------|                           |
  |                                    |--- NFT delivered -------->|
```

1. **Seller** locks their NFT into a smart contract escrow inside the Hydra Head
2. **Buyer** clicks Buy — the backend builds and submits an L2 transaction
3. The trade settles **instantly** — seller gets ADA, buyer gets NFT — no fees

---

## Stack

| Layer | Technology |
|---|---|
| Smart contract | [Aiken](https://aiken-lang.org) (Plutus v3) |
| Backend | Node.js 22 + Express + TypeScript |
| Database | PostgreSQL 15+ |
| Frontend | Next.js 14 + Tailwind CSS |
| Wallet | CIP-30 (Eternl, Nami, Lace) |
| L2 | [Hydra Head](https://hydra.family) v1.2.0 |

---

## Project structure

```
hydra-nft-marketplace/
├── contracts/          Aiken smart contract (listing validator)
├── backend/            Express API — listing, buy, cancel flows
│   ├── src/
│   └── .env.example    ← copy to .env and fill in your values
├── frontend/           Next.js 14 app — browse, sell, buy, cancel
├── hydra/
│   ├── config/
│   │   ├── .env.example  ← copy to .env and fill in your paths
│   │   └── protocol-parameters-zero-fees.json
│   ├── keys/           operator keys (generated locally, never committed)
│   ├── scripts/        node lifecycle scripts
│   └── Makefile        shortcuts: make start / stop / status / logs
├── docs/               architecture, API spec, dev report
└── e2e/                end-to-end tests
```

---

## Getting started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [cardano-node](https://github.com/IntersectMBO/cardano-node) | 10.x | synced to preprod |
| [hydra-node](https://hydra.family/head-protocol/docs/getting-started) | 1.2.0 | |
| [aiken](https://aiken-lang.org/installation-instructions) | 1.1.x | contract compilation |
| Node.js | 20+ | |
| PostgreSQL | 15+ | |

---

### Step 1 — Generate operator keys

The **operator** is the backend's on-chain identity. It funds the Hydra Head and co-signs transactions. Generate a fresh key pair:

```bash
# Cardano payment key pair
cardano-cli address key-gen \
  --normal-key \
  --signing-key-file  hydra/keys/cardano.skey \
  --verification-key-file hydra/keys/cardano.vkey

# Derive the operator address (preprod)
cardano-cli address build \
  --payment-verification-key-file hydra/keys/cardano.vkey \
  --testnet-magic 1 \
  --out-file hydra/keys/cardano.addr

# Hydra key pair
hydra-node gen-hydra-key --output-file hydra/keys/hydra
```

> **Security:** `hydra/keys/*.skey` and `hydra/keys/*.sk` are listed in `.gitignore` and will never be committed. Back them up somewhere safe outside the repo.

Fund `hydra/keys/cardano.addr` with test ADA from the [preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/) — at least **50 ADA** to commit into the Head.

---

### Step 2 — Configure environment files

```bash
# Backend
cp backend/.env.example backend/.env

# Hydra node
cp hydra/config/.env.example hydra/config/.env
```

Edit each file — the comments inside explain every variable. Key things to fill in:

**`backend/.env`**
- `BLOCKFROST_PROJECT_ID` — free key from [blockfrost.io](https://blockfrost.io)
- `CARDANO_CLI_PATH` — absolute path to your `cardano-cli` binary
- `SKEY_PATH` — absolute path to `hydra/keys/cardano.skey`
- `CARDANO_NODE_SOCKET_PATH` — path to the running cardano-node socket
- `OPERATOR_ADDRESS` — contents of `hydra/keys/cardano.addr`
- `SCRIPT_ADDRESS`, `SCRIPT_CBOR` — derived after compiling the contract (Step 4)

**`hydra/config/.env`**
- `HYDRA_BIN`, `CARDANO_CLI` — paths to installed binaries
- `NODE_SOCKET` — path to the cardano-node socket
- `MARKETPLACE_DIR` — absolute path to this repository root

---

### Step 3 — Set up the database

```bash
# Create user + database
psql -U postgres <<'SQL'
CREATE USER marketplace WITH PASSWORD 'marketplace';
CREATE DATABASE marketplace OWNER marketplace;
SQL

# Run migrations
psql -U marketplace -d marketplace -f backend/src/db/schema.sql
```

---

### Step 4 — Compile the contract

```bash
cd contracts
aiken build        # compiles to contracts/plutus.json
aiken check        # run all tests
```

The compiled UPLC lives in `contracts/plutus.json` under `validators[0].compiledCode`.
You need to **double-CBOR encode** it for `cardano-cli` and the backend:

```bash
# Quick helper (Node.js)
node -e "
const raw = require('./contracts/plutus.json').validators[0].compiledCode;
// raw is already single-CBOR; wrap in an outer CBOR byte-string
const len = raw.length / 2;
const prefix = len <= 0x17   ? (0x40 + len).toString(16).padStart(2,'0')
             : len <= 0xff   ? '58' + len.toString(16).padStart(2,'0')
             : len <= 0xffff ? '59' + len.toString(16).padStart(4,'0')
             :                 '5a' + len.toString(16).padStart(8,'0');
console.log(prefix + raw);
"
```

Paste the output into `SCRIPT_CBOR` in `backend/.env`.

To derive `SCRIPT_ADDRESS`, submit the double-CBOR script to `cardano-cli`:

```bash
# Save the double-CBOR as a .plutus file
echo '{"type":"PlutusScriptV3","description":"","cborHex":"<SCRIPT_CBOR>"}' > /tmp/listing.plutus

cardano-cli latest address build \
  --payment-script-file /tmp/listing.plutus \
  --testnet-magic 1
# → addr_test1w...  (paste into SCRIPT_ADDRESS in backend/.env)
```

---

### Step 5 — Install dependencies

```bash
cd backend  && npm install
cd ../frontend && npm install
```

---

### Step 6 — Start all services

Start each in a separate terminal (or tmux pane):

**Terminal 1 — Cardano node** (skip if already synced)
```bash
# however you normally run your preprod node
cardano-node run --config ... --socket-path ...
```

**Terminal 2 — Hydra node**
```bash
cd hydra
make start          # starts in a tmux session named 'hydra-marketplace'
make logs           # tail the logs
make status         # health check
```

**Terminal 3 — Backend**
```bash
cd backend
npm run dev         # tsx watch — auto-reloads on file changes
# Listening on http://localhost:3000
```

**Terminal 4 — Frontend**
```bash
cd frontend
npm run dev         # Next.js dev server
# Open http://localhost:3001
```

Confirm everything is up:
```bash
curl http://localhost:3000/api/head/status   # {"status":"Open",...}
curl http://localhost:4001/snapshot/utxo     # UTxO set in the Head
```

---

### Step 7 — Open the Hydra Head

The Head must be opened once before trading can begin. This is a one-time L1 operation.

1. **Init** — sends the `Init` command and creates the on-chain Head datum
   ```bash
   curl -X POST http://localhost:3000/api/head/init
   ```

2. **Commit** — each participant commits funds into the Head
   ```bash
   cd hydra && make commit            # commits 50 ADA from the operator
   ```
   Sellers commit their NFTs + a small ADA buffer via the frontend Sell page (classic commit flow).

3. **Collect** — opens the Head once all commits are on-chain
   ```bash
   curl -X POST http://localhost:3000/api/head/collect
   ```
   Or click **Abrir Head** on the frontend Sell page.

4. **Split ADA** — prepare collateral UTxOs for buy transactions
   ```bash
   curl -X POST http://localhost:3000/api/head/split-ada
   ```

The Head is now open. Sellers can list NFTs and buyers can purchase them instantly.

---

## Hydra Head — quick reference

| Command | What it does |
|---|---|
| `make start` | Start hydra-node in a tmux session |
| `make stop` | Stop the node |
| `make restart` | Stop + start |
| `make status` | Show process, API health, UTxO count, wallet balance |
| `make logs` | Tail the node logs |
| `make snapshot` | Print the current UTxO set as JSON |
| `make check` | Verify all prerequisites (binaries, socket, keys) |

---

## Smart contract

The Aiken validator (`contracts/validators/listing.ak`) enforces three spending paths:

| Redeemer | Who can execute | Condition |
|---|---|---|
| `Buy` | Anyone | Buyer sends correct ADA; NFT released to buyer; ADA to seller |
| `Cancel` | Seller only | Seller's signature required; NFT returned |
| `Update` | Seller only | Price update while NFT stays in escrow |

All transactions execute inside the Hydra Head — instant and fee-free.

---

## Contract values (preprod, current deployment)

```
Script hash:    2d7821003f93368a1ffd1440e87b2f5da938b7b87b99c846ea1e6e88
Script address: addr_test1wrzxkkq3p0w40hpn94dldxjkttrddvqed4e0xhvr4xcsrtqv640py
Hydra Head ID:  94dac729cf5ad21960639e070612328d1be7d0603aec0a27d71ca30c
```

> These are **derived public values** — the script hash and address are safe to share. The Head ID identifies the on-chain Head datum.

---

## Documentation

- [`docs/dev-report.md`](docs/dev-report.md) — full development log, all bugs fixed, testing guide
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/spec-validator.md`](docs/spec-validator.md) — smart contract specification
- [`docs/spec-api.md`](docs/spec-api.md) — REST API reference

---

## License

MIT
