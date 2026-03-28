# Hydra NFT Marketplace — Architecture

## 1. Overview

This document describes the system architecture for a **Hydra-based NFT marketplace MVP** built on Cardano.

The system enables fast, low-cost NFT trades executed inside a **Hydra Head**, while maintaining a familiar web application experience.

### Core Principle

> Hydra is the source of truth for execution (UTxO state), while the backend database is a projection layer for application state.

---

## 2. High-Level Architecture

```
User
  ↓
Frontend (Next.js)
  ↓
Backend API (Node.js)
  ↓
Hydra Client Layer
  ↓
Hydra Nodes (Head Participants)
  ↓
Cardano Ledger Rules (L1 compatibility)

Backend ↔ PostgreSQL (state projection)
```

---

## 3. Core Components

## 3.1 Frontend (Next.js / React)

### Responsibilities

- Wallet connection (Cardano wallets)
- Display NFT listings
- Create listing requests
- Trigger buy and cancel actions
- Display transaction status
- Show Head status (open/closed)

### Constraints

- No business logic enforcement
- No direct Hydra interaction
- Stateless except for UI state

---

## 3.2 Backend API (Node.js / TypeScript)

### Responsibilities

- REST API for frontend
- Marketplace state machine
- Transaction construction
- Hydra integration
- Event ingestion and processing
- Validation of all actions

### Key Modules

- **Listing Service** — create/update listings
- **Sale Service** — execute purchases
- **Hydra Client** — WebSocket + HTTP integration
- **Tx Builder** — constructs Cardano transactions
- **State Sync Engine** — updates DB from Hydra events

---

## 3.3 Hydra Layer

### Components

- hydra-node instances (2–3 operators)
- Hydra Head lifecycle management

### Responsibilities

- Maintain shared UTxO state
- Validate and apply transactions
- Provide WebSocket events
- Provide snapshot queries

### Key Operations

- Init Head
- Commit UTxOs
- Open Head
- Submit `NewTx`
- Close Head
- Fanout

---

## 3.4 Smart Contracts (Aiken)

### Purpose

Provide trust-minimized validation for NFT marketplace operations.

### Responsibilities

- Validate listing escrow
- Validate purchase conditions
- Validate cancellation authorization

### Design Principles

- Minimal logic
- Deterministic behavior
- Strong test coverage

---

## 3.5 Database (PostgreSQL)

### Role

Projection layer for marketplace state.

### Stores

- Listings
- Sales
- Wallet users
- Hydra events
- Transaction submissions
- Head sessions

### Important Rule

> Database state must always be reconcilable with Hydra UTxO state.

---

## 4. Data Flow

## 4.1 Listing Flow

```
User → Frontend → Backend → Validation
→ (Optional escrow tx)
→ Store listing in DB
→ UI update
```

---

## 4.2 Buy Flow

```
User → Frontend → Backend
→ Fetch latest listing state
→ Query Hydra UTxO (or cached state)
→ Build transaction
→ Submit via Hydra `NewTx`
→ Hydra confirms
→ Backend updates DB
→ UI reflects sale
```

---

## 4.3 Cancellation Flow

```
User → Backend
→ Validate seller
→ Build cancel tx
→ Submit to Hydra
→ Update DB
```

---

## 5. State Model

## 5.1 Source of Truth

- Hydra Head UTxO = execution truth

## 5.2 Derived State

- PostgreSQL = queryable app state

## 5.3 Synchronization Strategy

1. Receive Hydra event
2. Persist raw event
3. Update derived tables
4. Notify frontend

---

## 6. Hydra Integration Design

## 6.1 Communication

- WebSocket: event stream (default port 4001)
- HTTP: queries and commands

## 6.2 Required Features

- Submit transactions: `{ "tag": "NewTx", "transaction": <signed-cbor> }`
- Close Head: `{ "tag": "Close" }`
- Fanout: `{ "tag": "Fanout" }`
- Query snapshot UTxO: `GET /snapshot/utxo`

### Contestation period

All participants must configure the **same** `--contestation-period` value or the Head will not open. Default for mainnet: 12 hours. Use shorter values on devnet/preprod. The hydra-node contests automatically if it detects a newer snapshot — no custom logic needed in the backend.

## 6.3 Event Handling

Events drive all updates. Exact WebSocket event names from the Hydra API:

| Event | Trigger | Backend action |
|---|---|---|
| `HeadIsInitializing` | Init submitted | HeadSession → `initializing` |
| `Committed` | Participant commits | Log |
| `HeadIsOpen` | All committed | HeadSession → `open`; enable trades |
| `TxValid` | Tx accepted by Head | Mark listing sold; insert sale record |
| `TxInvalid` | Tx rejected | Mark tx_submission failed |
| `SnapshotConfirmed` | New snapshot | Refresh UTxO cache |
| `HeadIsClosed` | Close submitted | HeadSession → `closed` |
| `ReadyToFanout` | Contestation deadline passed | HeadSession → `fanout_pending` |

---

## 7. Transaction Architecture

## 7.1 Principles

- Atomic transfers (NFT + ADA)
- No partial execution
- Idempotent submission

## 7.2 Flow

1. Build transaction
2. Attach required inputs/outputs
3. Submit to Hydra
4. Await confirmation event

---

## 8. Custody Model

### Recommended: Script-based escrow (Aiken)

- NFTs locked in validator
- Rules enforced on-chain
- Hydra executes same validation logic

### Alternative: Operator-managed

- Faster to implement
- Less trust-minimized

---

## 9. Failure Handling

### Cases

- Hydra disconnected
- Tx submission failure
- Double-buy attempts
- Stale listing state
- Hydra node crash during open Head
- Contestation period blocking fanout

### Strategies

- Retry with idempotency keys
- Reconcile DB with Hydra snapshot
- Reject stale operations
- Log all submissions
- If a node crashes during an open Head, the Head may be blocked until the node recovers or the Head is closed by another participant. Design for graceful degradation: pause listing/buy flows, surface Head status clearly in the UI.
- Model `contesting` as an explicit blocking state between `closed` and `fanout_pending`. Do not attempt new trades or listing state changes during contestation.

### Static participant constraint

Hydra Head participants are fixed at Init time. Operators cannot be added after the Head is open. Plan capacity and operator set before initializing each Head session.

---

## 10. Deployment Architecture

## 10.1 Local Dev

- Docker Compose
- Hydra devnet
- Backend
- Frontend
- PostgreSQL

## 10.2 Preprod

- 2–3 Hydra nodes
- Hosted backend
- Hosted frontend
- Managed DB

---

## 11. Observability

### Metrics

- Head status
- Tx latency
- Success/failure rate
- Active listings

### Logging

- Hydra events
- Tx submissions
- Errors

### Admin Dashboard

- Head lifecycle state
- Recent events
- Failed txs

---

## 12. Security Model

### Key Rules

- Backend validates all state transitions
- No trust in frontend
- Secrets isolated from UI

### Risks

- Double spend attempts
- Unauthorized cancellation
- State desync

### Mitigation

- Always verify against Hydra state
- Use idempotent operations
- Audit logs

---

## 13. Scalability Considerations

- Hydra Heads scale horizontally
- Multiple Heads can serve different markets
- Backend can shard by Head

---

## 14. Future Extensions

- Auctions
- Multi-head routing
- Trustless participant onboarding
- Advanced order books

---

## 15. Summary

This architecture prioritizes:

- Simplicity for MVP delivery
- Correctness via Hydra + Aiken
- Clear separation of concerns
- Fast user experience

It provides a solid foundation for evolving into a fully decentralized Hydra-native marketplace.

