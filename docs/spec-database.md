# Database Specification — Hydra NFT Marketplace

Network: Cardano preprod
Engine: PostgreSQL 15+

---

## Tables

### `wallet_users`

```sql
CREATE TABLE wallet_users (
  address       TEXT PRIMARY KEY,           -- bech32 Cardano address
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### `head_sessions`

```sql
CREATE TYPE head_status AS ENUM (
  'idle',
  'initializing',
  'open',
  'closed',
  'contesting',
  'fanout_pending',
  'finalized'
);

CREATE TABLE head_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                    head_status NOT NULL DEFAULT 'idle',
  network                   TEXT NOT NULL DEFAULT 'preprod',
  contestation_period_secs  INT NOT NULL DEFAULT 180,   -- preprod: 3 min; mainnet: 43200 (12h)
  opened_at                 TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  contestation_deadline     TIMESTAMPTZ,                -- set on HeadIsClosed event
  finalized_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Constraint**: only one session can be in status `open` at a time.

```sql
CREATE UNIQUE INDEX head_sessions_one_open
  ON head_sessions (status)
  WHERE status = 'open';
```

---

### `assets`

```sql
CREATE TABLE assets (
  policy_id   TEXT NOT NULL,
  asset_name  TEXT NOT NULL,           -- hex encoded
  unit        TEXT NOT NULL GENERATED ALWAYS AS (policy_id || asset_name) STORED,
  display_name TEXT,
  image_url   TEXT,
  metadata    JSONB,
  PRIMARY KEY (policy_id, asset_name)
);

CREATE UNIQUE INDEX assets_unit ON assets (unit);
```

---

### `listings`

```sql
CREATE TYPE listing_status AS ENUM (
  'draft',       -- created, escrow tx not yet confirmed
  'active',      -- escrow UTxO confirmed in Head
  'sold',        -- buy tx confirmed (TxValid)
  'cancelled',   -- cancel tx confirmed (TxValid)
  'failed'       -- escrow or submission failed permanently
);

CREATE TABLE listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_address    TEXT NOT NULL REFERENCES wallet_users(address),
  policy_id         TEXT NOT NULL,
  asset_name        TEXT NOT NULL,                            -- hex
  unit              TEXT NOT NULL GENERATED ALWAYS AS (policy_id || asset_name) STORED,
  price_lovelace    BIGINT NOT NULL CHECK (price_lovelace > 0),
  status            listing_status NOT NULL DEFAULT 'draft',
  escrow_tx_hash    TEXT,                                     -- set when draft → active
  escrow_utxo_ix    INT,                                      -- output index of the escrow UTxO
  head_session_id   UUID NOT NULL REFERENCES head_sessions(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_id, asset_name) REFERENCES assets(policy_id, asset_name)
);

-- Prevent double-listing same NFT while active
CREATE UNIQUE INDEX listings_active_unit
  ON listings (unit)
  WHERE status = 'active';

CREATE INDEX listings_by_status ON listings (status);
CREATE INDEX listings_by_seller ON listings (seller_address);
CREATE INDEX listings_by_session ON listings (head_session_id);
```

---

### `sales`

```sql
CREATE TYPE sale_status AS ENUM (
  'pending',     -- NewTx submitted, waiting TxValid
  'confirmed',   -- TxValid received
  'failed'       -- TxInvalid received
);

CREATE TABLE sales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       UUID NOT NULL REFERENCES listings(id),
  buyer_address    TEXT NOT NULL REFERENCES wallet_users(address),
  seller_address   TEXT NOT NULL,
  unit             TEXT NOT NULL,
  price_lovelace   BIGINT NOT NULL,
  hydra_tx_id      TEXT,                          -- tx hash inside the Head
  status           sale_status NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ
);

-- One confirmed sale per listing
CREATE UNIQUE INDEX sales_one_confirmed
  ON sales (listing_id)
  WHERE status = 'confirmed';

CREATE INDEX sales_by_buyer ON sales (buyer_address);
```

---

### `hydra_events`

```sql
CREATE TABLE hydra_events (
  id               BIGSERIAL PRIMARY KEY,
  head_session_id  UUID NOT NULL REFERENCES head_sessions(id),
  sequence         BIGINT,                        -- seq from Hydra if present
  tag              TEXT NOT NULL,                 -- HeadIsOpen, TxValid, etc.
  payload          JSONB NOT NULL,                -- raw event as received
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hydra_events_by_session ON hydra_events (head_session_id, received_at);
CREATE INDEX hydra_events_by_tag     ON hydra_events (tag);
```

---

### `tx_submissions`

```sql
CREATE TYPE tx_action AS ENUM ('list', 'buy', 'cancel');
CREATE TYPE submission_status AS ENUM ('pending', 'confirmed', 'failed');

CREATE TABLE tx_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      TEXT NOT NULL UNIQUE,           -- client-supplied idempotency key
  listing_id      UUID REFERENCES listings(id),
  action          tx_action NOT NULL,
  hydra_tx_id     TEXT,                           -- filled after NewTx accepted
  status          submission_status NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ
);

CREATE INDEX tx_submissions_by_listing ON tx_submissions (listing_id);
CREATE INDEX tx_submissions_by_status  ON tx_submissions (status);
```

---

## State transition triggers

### Listing status transitions (enforced at application layer)

| From    | To        | Trigger                              |
|---------|-----------|--------------------------------------|
| draft   | active    | `TxValid` for escrow tx              |
| draft   | failed    | `TxInvalid` for escrow tx            |
| active  | sold      | `TxValid` for buy tx                 |
| active  | cancelled | `TxValid` for cancel tx              |
| active  | failed    | Head closes while listing active     |

### HeadSession status transitions

| From           | To             | Trigger                              |
|----------------|----------------|--------------------------------------|
| idle           | initializing   | `Init` command sent                  |
| initializing   | open           | `HeadIsOpen` event                   |
| open           | closed         | `HeadIsClosed` event                 |
| closed         | contesting     | `HeadIsContested` event (if any)     |
| closed         | fanout_pending | `ReadyToFanout` event                |
| contesting     | fanout_pending | `ReadyToFanout` event                |
| fanout_pending | finalized      | `Fanout` command confirmed on L1     |

---

## Updated_at trigger

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
