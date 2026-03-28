# State Machine Specification — Hydra NFT Marketplace

---

## 1. HeadSession State Machine

### States

| State           | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| `idle`          | No active Head. System at rest.                                       |
| `initializing`  | `Init` sent. Waiting for all participants to commit.                  |
| `open`          | Head active. Trades enabled. UTxO set live inside Head.              |
| `closed`        | `Close` submitted with a snapshot. Contestation period running.       |
| `contesting`    | A participant contested the closed snapshot. New deadline set.        |
| `fanout_pending`| Contestation deadline passed. Ready to distribute funds to L1.        |
| `finalized`     | Fanout complete. All UTxOs settled on L1. Session over.               |

### Transitions

```
idle
 └─[Init command sent]──────────────────────────────► initializing
      └─[HeadIsOpen event]────────────────────────────► open
           └─[HeadIsClosed event]──────────────────────► closed
                ├─[HeadIsContested event]───────────────► contesting
                │    └─[ReadyToFanout event]─────────────► fanout_pending
                └─[ReadyToFanout event]──────────────────► fanout_pending
                     └─[Fanout confirmed on L1]───────────► finalized
```

### Preconditions per transition

| Transition                        | Precondition                                          |
|-----------------------------------|-------------------------------------------------------|
| `idle` → `initializing`           | No session with status `open` exists                  |
| `initializing` → `open`           | `HeadIsOpen` event received from Hydra WS             |
| `open` → `closed`                 | `HeadIsClosed` event received; set `contestation_deadline` from event payload |
| `closed` → `contesting`           | `HeadIsContested` event received; update `contestation_deadline` |
| `closed/contesting` → `fanout_pending` | `ReadyToFanout` event received; `now() >= contestation_deadline` |
| `fanout_pending` → `finalized`    | `Fanout` WS command sent and L1 tx confirmed          |

### Effects per transition

| Transition                        | Side effects                                          |
|-----------------------------------|-------------------------------------------------------|
| `open` reached                    | Enable listing creation and buy flows                 |
| `closed` reached                  | Pause all new listings and buys; set all `active` listings to `failed` |
| `fanout_pending` reached          | Notify admin; unlock Fanout button in UI             |
| `finalized` reached               | Archive session; mark all remaining `active` listings `failed` |

---

## 2. Listing State Machine

### States

| State       | Description                                                              |
|-------------|--------------------------------------------------------------------------|
| `draft`     | Record created. Escrow tx built but not yet submitted to Head.           |
| `active`    | Escrow UTxO confirmed inside the Head (`TxValid` for escrow tx).         |
| `sold`      | Buy tx confirmed (`TxValid` for buy tx). Sale record created.            |
| `cancelled` | Cancel tx confirmed (`TxValid` for cancel tx). NFT returned to seller.   |
| `failed`    | Escrow or submission failed; or Head closed while listing was active.    |

### Transitions

```
draft
 ├─[TxValid for escrow tx]──────────────────────────► active
 └─[TxInvalid for escrow tx]────────────────────────► failed

active
 ├─[TxValid for buy tx]────────────────────────────► sold
 ├─[TxValid for cancel tx]─────────────────────────► cancelled
 └─[HeadIsClosed while active]──────────────────────► failed
```

### Preconditions per transition

| Transition             | Precondition                                                          |
|------------------------|-----------------------------------------------------------------------|
| create `draft`         | Head is `open`; NFT not already listed; NFT owned by seller (Blockfrost check) |
| `draft` → `active`     | `TxValid` event received for `escrow_tx_hash`                         |
| `draft` → `failed`     | `TxInvalid` event received for `escrow_tx_hash`                       |
| `active` → `sold`      | `TxValid` for buy tx; sale record in `pending` state exists           |
| `active` → `cancelled` | `TxValid` for cancel tx; cancellation submission exists               |
| `active` → `failed`    | `HeadIsClosed` event and listing has no confirmed sale                |

### Idempotency rules

- A listing can only move to `sold` once — enforced by `UNIQUE INDEX sales_one_confirmed`.
- A `requestId` can only be used once — enforced by `UNIQUE` on `tx_submissions.request_id`.
- If a buy request arrives for a listing already in `sold` state → return `409 listing_not_available`.

---

## 3. Sale State Machine

### States

| State       | Description                                            |
|-------------|--------------------------------------------------------|
| `pending`   | `NewTx` submitted to Hydra. Awaiting `TxValid`.        |
| `confirmed` | `TxValid` received. Listing marked `sold`.             |
| `failed`    | `TxInvalid` received. Listing remains `active`.        |

### Transitions

```
pending
 ├─[TxValid event for hydra_tx_id]────────────────► confirmed
 └─[TxInvalid event for hydra_tx_id]──────────────► failed
```

### On `confirmed`

1. Set `sales.status = confirmed`, `confirmed_at = now()`
2. Set `listings.status = sold`
3. Notify frontend via SSE/polling

### On `failed`

1. Set `sales.status = failed`
2. Log `error_message` from `TxInvalid` payload
3. Listing remains `active` — buyer can retry

---

## 4. Hydra Event → State Transition Map

This table defines exactly which events the backend must handle and what they trigger.

| Hydra Event          | Action                                                                  |
|----------------------|-------------------------------------------------------------------------|
| `HeadIsInitializing` | HeadSession → `initializing`                                            |
| `Committed`          | Log event; no state change                                              |
| `HeadIsOpen`         | HeadSession → `open`; extract initial UTxO set from payload             |
| `TxValid`            | Match `tx_id` against `tx_submissions`; apply listing/sale transitions  |
| `TxInvalid`          | Match `tx_id`; mark submission failed; revert listing if escrow         |
| `SnapshotConfirmed`  | Update in-memory UTxO cache from `snapshot.utxo` payload                |
| `HeadIsClosed`       | HeadSession → `closed`; extract `contestationDeadline` from payload; all active listings → `failed` |
| `HeadIsContested`    | HeadSession → `contesting`; update `contestation_deadline`              |
| `ReadyToFanout`      | HeadSession → `fanout_pending`                                          |
| `Greetings`          | Log; verify `headStatus` matches DB; reconcile if mismatch              |

---

## 5. Reconciliation rule

On backend startup or WebSocket reconnection:

1. Send `GET /snapshot/utxo` to Hydra node
2. Compare escrow UTxOs in snapshot against `listings` with status `active`
3. Any `active` listing whose escrow UTxO is absent from snapshot → mark `failed`
4. Log discrepancies for admin review

This prevents stale listings surviving a restart or reconnect.
