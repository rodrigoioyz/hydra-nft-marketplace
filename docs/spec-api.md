# API Specification — Hydra NFT Marketplace

Base URL: `/api`
Content-Type: `application/json`
All timestamps: ISO 8601 UTC strings.

---

## Public Endpoints

---

### `GET /api/listings`

Return all active listings.

**Query params (optional)**

| Param    | Type   | Description              |
|----------|--------|--------------------------|
| status   | string | Filter by listing_status |
| seller   | string | Filter by seller address |
| limit    | int    | Default 50, max 100      |
| offset   | int    | Default 0                |

**Response 200**

```json
{
  "listings": [
    {
      "id": "uuid",
      "sellerAddress": "addr_test1...",
      "policyId": "hex",
      "assetName": "hex",
      "unit": "hex",
      "displayName": "My NFT #1",
      "imageUrl": "https://...",
      "priceLovelace": "5000000",
      "status": "active",
      "escrowTxHash": "hex",
      "escrowUtxoIx": 0,
      "createdAt": "2026-03-28T00:00:00Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

---

### `GET /api/listings/:id`

Return a single listing with sale history.

**Response 200**

```json
{
  "id": "uuid",
  "sellerAddress": "addr_test1...",
  "policyId": "hex",
  "assetName": "hex",
  "unit": "hex",
  "displayName": "My NFT #1",
  "imageUrl": "https://...",
  "priceLovelace": "5000000",
  "status": "active",
  "escrowTxHash": "hex",
  "escrowUtxoIx": 0,
  "sale": null,
  "createdAt": "2026-03-28T00:00:00Z",
  "updatedAt": "2026-03-28T00:00:00Z"
}
```

When sold, `sale` is:

```json
{
  "id": "uuid",
  "buyerAddress": "addr_test1...",
  "hydraTxId": "hex",
  "status": "confirmed",
  "confirmedAt": "2026-03-28T00:01:00Z"
}
```

**Response 404**

```json
{ "error": "listing_not_found" }
```

---

### `POST /api/listings`

Create a new listing. Seller must have the NFT in a wallet accessible to the backend or must sign the escrow tx.

**Request**

```json
{
  "requestId": "client-uuid",
  "sellerAddress": "addr_test1...",
  "policyId": "hex",
  "assetName": "hex",
  "priceLovelace": "5000000"
}
```

**Validation rules**

- `priceLovelace` must be > 2_000_000 (min 2 ADA)
- NFT must exist at `sellerAddress` (verified via Blockfrost)
- No active listing for same `unit` must exist
- Head session must be in `open` status

**Response 201**

```json
{
  "listingId": "uuid",
  "status": "draft",
  "escrowTxCbor": "hex",
  "message": "Sign and submit escrowTxCbor to activate listing"
}
```

The frontend must sign `escrowTxCbor` with the seller wallet and submit it back.

**Response 409**

```json
{ "error": "already_listed", "existingListingId": "uuid" }
```

**Response 503**

```json
{ "error": "head_not_open", "headStatus": "idle" }
```

---

### `POST /api/listings/:id/escrow-confirm`

Called by the frontend after the seller signs and submits the escrow tx to the Head.

**Request**

```json
{
  "signedTxCbor": "hex"
}
```

**Response 200**

```json
{ "submissionId": "uuid", "status": "pending" }
```

The backend submits to Hydra via `NewTx` and waits for `TxValid`.

---

### `POST /api/listings/:id/buy`

Execute a purchase. The backend builds, signs (as operator), and submits the buy tx.

**Request**

```json
{
  "requestId": "client-uuid",
  "buyerAddress": "addr_test1..."
}
```

**Validation rules**

- Listing must have `status = active`
- No existing `pending` sale for this listing
- Head must be `open`
- Escrow UTxO must exist in current Head snapshot

**Response 202**

```json
{
  "saleId": "uuid",
  "submissionId": "uuid",
  "status": "pending",
  "message": "Purchase submitted to Hydra. Await confirmation."
}
```

**Response 409**

```json
{ "error": "listing_not_available", "status": "sold" }
```

**Response 503**

```json
{ "error": "head_not_open", "headStatus": "closed" }
```

---

### `POST /api/listings/:id/cancel`

Cancel an active listing. Requires seller authorization.

**Request**

```json
{
  "requestId": "client-uuid",
  "sellerAddress": "addr_test1...",
  "signedCancelTxCbor": "hex"
}
```

The frontend must sign the cancel tx (built via `GET /api/listings/:id/cancel-tx`) with the seller wallet.

**Validation rules**

- Listing must have `status = active`
- `sellerAddress` must match `listing.sellerAddress`
- Head must be `open`

**Response 202**

```json
{ "submissionId": "uuid", "status": "pending" }
```

---

### `GET /api/listings/:id/cancel-tx`

Build and return the unsigned cancel tx CBOR for the seller to sign.

**Response 200**

```json
{
  "unsignedTxCbor": "hex"
}
```

---

### `GET /api/portfolio/:address`

Return all listings and sales for a wallet address.

**Response 200**

```json
{
  "address": "addr_test1...",
  "activeListings": [...],
  "soldListings": [...],
  "purchases": [...]
}
```

---

### `GET /api/head/status`

Return current Head session state.

**Response 200**

```json
{
  "sessionId": "uuid",
  "status": "open",
  "network": "preprod",
  "contestationPeriodSecs": 180,
  "openedAt": "2026-03-28T00:00:00Z",
  "contestationDeadline": null
}
```

---

## Admin Endpoints

All admin endpoints require an `Authorization: Bearer <ADMIN_SECRET>` header.

---

### `POST /api/admin/head/init`

Send `Init` to the Hydra node.

**Response 200**

```json
{ "sessionId": "uuid", "status": "initializing" }
```

---

### `POST /api/admin/head/commit`

Commit UTxOs into the Head.

**Request**

```json
{
  "utxos": [
    { "txHash": "hex", "outputIndex": 0 }
  ]
}
```

**Response 200**

```json
{ "status": "committed" }
```

---

### `POST /api/admin/head/close`

Send `Close` to the Hydra node.

**Response 200**

```json
{ "status": "closed", "contestationDeadline": "2026-03-28T00:03:00Z" }
```

---

### `POST /api/admin/head/fanout`

Send `Fanout` after `ReadyToFanout` event.

**Response 200**

```json
{ "status": "finalized" }
```

**Response 409**

```json
{ "error": "not_ready_for_fanout", "headStatus": "contesting" }
```

---

### `GET /api/admin/events`

Return recent Hydra events.

**Query params**

| Param  | Type   | Default |
|--------|--------|---------|
| limit  | int    | 50      |
| tag    | string | (all)   |

**Response 200**

```json
{
  "events": [
    {
      "id": 1,
      "tag": "TxValid",
      "payload": { ... },
      "receivedAt": "2026-03-28T00:01:00Z"
    }
  ]
}
```

---

### `GET /api/admin/tx-submissions`

Return tx submission history with status.

**Response 200**

```json
{
  "submissions": [
    {
      "id": "uuid",
      "requestId": "client-uuid",
      "listingId": "uuid",
      "action": "buy",
      "hydraTxId": "hex",
      "status": "confirmed",
      "submittedAt": "2026-03-28T00:01:00Z",
      "confirmedAt": "2026-03-28T00:01:02Z"
    }
  ]
}
```

---

## Error format

All errors follow:

```json
{
  "error": "snake_case_code",
  "message": "Human readable description",
  "details": {}
}
```

### Standard error codes

| Code                   | HTTP | Description                              |
|------------------------|------|------------------------------------------|
| `listing_not_found`    | 404  | No listing with that ID                  |
| `already_listed`       | 409  | NFT already has an active listing        |
| `listing_not_available`| 409  | Listing is sold or cancelled             |
| `head_not_open`        | 503  | Head is not in open state                |
| `not_ready_for_fanout` | 409  | Contestation period not finished         |
| `unauthorized`         | 401  | Missing or invalid admin token           |
| `invalid_request`      | 400  | Validation failure (see details)         |
| `hydra_submission_failed` | 502 | Hydra returned TxInvalid               |
| `duplicate_request`    | 409  | requestId already used                   |
