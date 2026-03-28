# Hydra NFT Marketplace — Tickets (MVP Backlog)

## Overview

This document breaks the MVP into **epics and actionable tickets**.
Each ticket is:
- small
- testable
- independently executable

---

# EPIC 1 — Hydra Environment Setup

## Goal
Run a working Hydra Head locally and submit a basic transaction.

### T1.1 — Setup Hydra repo
- Clone hydra repository
- Install dependencies
- Verify build runs

### T1.2 — Run local devnet
- Start hydra nodes (2–3 participants)
- Confirm nodes are reachable

### T1.3 — Open Hydra Head
- Initialize head
- Commit ADA UTxOs
- Confirm head opens

### T1.4 — Submit basic transaction
- Build simple ADA transfer
- Submit via `NewTx`
- Confirm via WebSocket event

---

# EPIC 2 — Hydra Client Integration (Backend)

## Goal
Backend can communicate with Hydra reliably.

### T2.1 — WebSocket connection
- Connect to hydra-node WS
- Handle reconnect logic

### T2.2 — Event ingestion
- Parse incoming events
- Log raw events

### T2.3 — Snapshot UTxO fetch
- Query current UTxO
- Store in memory cache

### T2.4 — Submit transactions
- Implement `NewTx` call
- Handle success/failure

### T2.5 — Idempotency layer
- Add request IDs
- Prevent duplicate submissions

---

# EPIC 3 — Database Setup

## Goal
Persist marketplace state.

### T3.1 — Setup PostgreSQL
- Initialize DB
- Configure connection

### T3.2 — Create schema
- listings
- sales
- head_sessions
- hydra_events
- tx_submissions

### T3.3 — Event persistence
- Store all Hydra events

### T3.4 — Projection layer
- Map events → listings/sales updates

---

# EPIC 4 — Transaction Builder

## Goal
Construct valid Cardano transactions for marketplace actions.

### T4.1 — Setup tx builder module
- Integrate cardano serialization lib / Lucid

### T4.2 — Build transfer tx
- ADA transfer
- NFT transfer

### T4.3 — Build buy transaction
- Consume listing UTxO
- Pay seller
- Transfer NFT

### T4.4 — Build cancel transaction
- Return NFT to seller

### T4.5 — Validation checks
- Ensure correct inputs/outputs
- Prevent malformed txs

---

# EPIC 5 — Listings Backend

## Goal
Manage NFT listings.

### T5.1 — Create listing endpoint
- POST /listings

### T5.2 — Validate NFT ownership
- Check wallet assets

### T5.3 — Store listing
- Save in DB

### T5.4 — Prevent duplicate listings
- Enforce uniqueness

### T5.5 — Get listings
- GET /listings

### T5.6 — Get listing by ID
- GET /listings/:id

---

# EPIC 6 — Buy Flow Backend

## Goal
Execute NFT purchase inside Hydra.

### T6.1 — Buy endpoint
- POST /listings/:id/buy

### T6.2 — Validate listing state
- Ensure active and unsold

### T6.3 — Fetch latest UTxO
- From Hydra or cache

### T6.4 — Build buy tx
- Use tx builder

### T6.5 — Submit to Hydra
- Call `NewTx`

### T6.6 — Handle confirmation
- Update listing → sold
- Insert sale record

---

# EPIC 7 — Cancel Flow Backend

## Goal
Allow seller to cancel listings.

### T7.1 — Cancel endpoint
- POST /listings/:id/cancel

### T7.2 — Validate seller
- Match wallet address

### T7.3 — Build cancel tx

### T7.4 — Submit and confirm

### T7.5 — Update listing status

---

# EPIC 8 — Aiken Smart Contracts

## Goal
Implement escrow validation.

### T8.1 — Setup Aiken project

### T8.2 — Listing datum
- seller
- asset
- price

### T8.3 — Redeemer types
- Buy
- Cancel

### T8.4 — Validator logic
- Enforce correct payout
- Enforce correct asset transfer

### T8.5 — Contract tests
- Valid buy
- Invalid price
- Unauthorized cancel

### T8.6 — Compile to Plutus

---

# EPIC 9 — Frontend (Next.js)

## Goal
User interface for marketplace.

### T9.1 — Setup project

### T9.2 — Wallet connection

### T9.3 — Listings page
- Display all listings

### T9.4 — Listing detail page

### T9.5 — Sell page
- Create listing form

### T9.6 — Buy button flow

### T9.7 — Portfolio page

### T9.8 — Head status UI

---

# EPIC 10 — State Sync Engine

## Goal
Keep DB aligned with Hydra state.

### T10.1 — Event processor
- Consume Hydra events

### T10.2 — Update projections
- Listings
- Sales

### T10.3 — Reconciliation job
- Compare DB vs Hydra UTxO

---

# EPIC 11 — Admin & Observability

## Goal
Visibility into system health.

### T11.1 — Logging system

### T11.2 — Admin endpoints

### T11.3 — Head status dashboard

### T11.4 — Failed tx tracking

---

# EPIC 12 — End-to-End Testing

## Goal
Validate full MVP flow.

### T12.1 — List NFT test

### T12.2 — Buy NFT test

### T12.3 — Cancel listing test

### T12.4 — Hydra restart recovery test

### T12.5 — Head close + fanout test

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

- NFT listed
- NFT purchased inside Hydra
- Sale reflected in UI
- No double-spend
- Head lifecycle demonstrable

