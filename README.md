# Hydra NFT Marketplace

A fixed-price NFT marketplace on **Cardano** where trades happen inside a **Hydra Head** — Cardano's Layer 2 solution for instant, fee-free transactions.

---

## What is this?

On regular Cardano (Layer 1), every transaction takes ~20 seconds to confirm and costs a small fee. For a marketplace doing many trades, that adds up.

This project moves the trading activity into a **Hydra Head** — a private payment channel between participants where:
- Transactions confirm **instantly** (milliseconds)
- Fees are **zero**
- Everything is still secured by Cardano's cryptography

When trading is done, the final state is settled back on-chain.

---

## How it works

```
Seller                         Operator (backend)               Buyer
  |                                    |                           |
  |-- Lists NFT ---------------------->|                           |
  |   (sends NFT + ADA to escrow)      |                           |
  |                                    |<-- Browse listings -------|
  |                                    |<-- Buy NFT ---------------|
  |                                    |   (instant Hydra tx)      |
  |<-- Receives ADA instantly ---------|                           |
  |                                    |--- NFT delivered -------->|
```

1. **Seller** lists an NFT by depositing it (plus price in ADA) into a smart contract escrow
2. **Buyer** clicks Buy — the backend builds and submits a transaction inside the Hydra Head
3. The trade settles **instantly** — seller gets ADA, buyer gets NFT
4. No waiting, no fees inside the Head

---

## Stack

| Layer | Technology |
|---|---|
| Smart contract | [Aiken](https://aiken-lang.org) (Plutus v3) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL |
| Frontend | Next.js 14 + Tailwind CSS |
| Wallet | CIP-30 (Eternl, Nami, Lace) via MeshSDK |
| Oracle | Cardano preprod testnet |
| L2 | [Hydra Head](https://hydra.family) v1.2.0 |

---

## Project structure

```
hydra-nft-marketplace/
├── contracts/          Aiken smart contract (listing validator)
├── backend/            Express API — listing, buy, cancel flows
├── frontend/           Next.js 14 app — browse, sell, buy, cancel
├── hydra/              Hydra node config, keys, scripts
├── e2e/                End-to-end test suite
└── docs/               Architecture, specs, dev report
```

---

## Smart contract

The Aiken validator (`contracts/validators/listing.ak`) enforces three rules:

- **List** — NFT + price locked in escrow, seller address recorded
- **Buy** — buyer sends correct ADA, NFT released to buyer, ADA to seller
- **Cancel** — only the original seller can cancel and reclaim the NFT

All buy/cancel transactions execute **inside the Hydra Head** — instant and fee-free.

---

## Getting started

### Prerequisites

- [Cardano node](https://github.com/IntersectMBO/cardano-node) (preprod)
- [Hydra node](https://hydra.family) v1.2.0
- [Aiken](https://aiken-lang.org) (for contract compilation)
- Node.js 20+
- PostgreSQL

### 1. Configure environment

```bash
cp backend/.env.example backend/.env
cp hydra/config/.env.example hydra/config/.env
# Fill in your paths, keys, and Blockfrost API key
```

### 2. Compile the contract

```bash
cd contracts
aiken build        # outputs plutus.json
aiken check        # run all tests (14 tests)
```

Copy `compiledCode` from `plutus.json` into `SCRIPT_CBOR` in `backend/.env`.

### 3. Start the backend

```bash
cd backend
npm install
cp .env.example .env   # fill in values
npx tsx src/index.ts
# Listens on http://localhost:3000
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
# Opens on http://localhost:3001
```

### 5. Connect a wallet

Open the app, click **Connect Wallet**, and choose Eternl, Nami, or Lace. Your address auto-fills in all forms.

---

## Flows

### List an NFT
1. Go to **List NFT**
2. Enter policy ID, asset name, and price
3. Click **Create Listing** — wallet signs the escrow transaction
4. Once confirmed on-chain, the listing goes live

### Buy an NFT
1. Browse active listings, click on one
2. Click **Buy** — the backend submits an instant Hydra transaction
3. Done — NFT is yours, seller gets ADA

### Cancel a listing
1. Open your listing
2. Click **Cancel** — wallet signs the cancel transaction
3. NFT returns to your wallet

---

## Key design decisions

**Seller-funded escrow** — The escrow UTxO holds both the NFT and the price in ADA. The operator backend can execute the buy without needing to touch any buyer-owned UTxO. This avoids UTxO contention.

**Zero-fee Hydra params** — The Hydra Head is started with `protocol-parameters-zero-fees.json`, so all trades inside the Head cost nothing.

**Operator-signed buy** — The backend (operator) signs buy transactions. The buyer just provides their address; no wallet signing needed for the buy flow.

---

## Contract values (preprod)

```
Script hash:    8f6e69350f02a04688c6e82fe3e7aebcded7be4ecd0246e727ad3ebc
Script address: addr_test1wz8ku6f4pup2q35gcm5zlcl8467da4a7fmxsy3h8y7kna0q0thcrm
Hydra Head ID:  d59f9af876aac5490673b2824481fd7a475c134e477a303784b02043
```

---

## Documentation

- [`docs/dev-report.md`](docs/dev-report.md) — full development report, all bugs fixed, testing guide
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/spec-validator.md`](docs/spec-validator.md) — smart contract specification
- [`docs/spec-api.md`](docs/spec-api.md) — REST API reference

---

## License

MIT
