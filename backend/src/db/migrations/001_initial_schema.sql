-- Migration 001 — Initial marketplace schema
-- Based on spec-database.md

-- ── Types ────────────────────────────────────────────────────────────────────

CREATE TYPE head_status AS ENUM (
  'idle', 'initializing', 'open', 'closed',
  'contesting', 'fanout_pending', 'finalized'
);

CREATE TYPE listing_status AS ENUM (
  'draft', 'active', 'sold', 'cancelled', 'failed'
);

CREATE TYPE sale_status AS ENUM (
  'pending', 'confirmed', 'failed'
);

CREATE TYPE tx_action AS ENUM ('list', 'buy', 'cancel');

CREATE TYPE submission_status AS ENUM ('pending', 'confirmed', 'failed');

-- ── wallet_users ──────────────────────────────────────────────────────────────

CREATE TABLE wallet_users (
  address     TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── head_sessions ─────────────────────────────────────────────────────────────

CREATE TABLE head_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  head_id                   TEXT,                    -- set on HeadIsInitializing
  status                    head_status NOT NULL DEFAULT 'idle',
  network                   TEXT NOT NULL DEFAULT 'preprod',
  contestation_period_secs  INT NOT NULL DEFAULT 600,
  opened_at                 TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  contestation_deadline     TIMESTAMPTZ,
  finalized_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open session at a time
CREATE UNIQUE INDEX head_sessions_one_open
  ON head_sessions (status)
  WHERE status = 'open';

-- ── assets ───────────────────────────────────────────────────────────────────

CREATE TABLE assets (
  policy_id    TEXT NOT NULL,
  asset_name   TEXT NOT NULL,
  unit         TEXT NOT NULL GENERATED ALWAYS AS (policy_id || asset_name) STORED,
  display_name TEXT,
  image_url    TEXT,
  metadata     JSONB,
  PRIMARY KEY  (policy_id, asset_name)
);

CREATE UNIQUE INDEX assets_unit ON assets (unit);

-- ── listings ─────────────────────────────────────────────────────────────────

CREATE TABLE listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_address   TEXT NOT NULL,
  policy_id        TEXT NOT NULL,
  asset_name       TEXT NOT NULL,
  unit             TEXT NOT NULL GENERATED ALWAYS AS (policy_id || asset_name) STORED,
  price_lovelace   BIGINT NOT NULL CHECK (price_lovelace > 0),
  status           listing_status NOT NULL DEFAULT 'draft',
  escrow_tx_hash   TEXT,
  escrow_utxo_ix   INT,
  head_session_id  UUID NOT NULL REFERENCES head_sessions(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX listings_active_unit
  ON listings (unit)
  WHERE status = 'active';

CREATE INDEX listings_by_status  ON listings (status);
CREATE INDEX listings_by_seller  ON listings (seller_address);
CREATE INDEX listings_by_session ON listings (head_session_id);

-- ── sales ─────────────────────────────────────────────────────────────────────

CREATE TABLE sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings(id),
  buyer_address   TEXT NOT NULL,
  seller_address  TEXT NOT NULL,
  unit            TEXT NOT NULL,
  price_lovelace  BIGINT NOT NULL,
  hydra_tx_id     TEXT,
  status          sale_status NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX sales_one_confirmed
  ON sales (listing_id)
  WHERE status = 'confirmed';

CREATE INDEX sales_by_buyer ON sales (buyer_address);

-- ── hydra_events ──────────────────────────────────────────────────────────────

CREATE TABLE hydra_events (
  id               BIGSERIAL PRIMARY KEY,
  head_session_id  UUID REFERENCES head_sessions(id),
  sequence         BIGINT,
  tag              TEXT NOT NULL,
  payload          JSONB NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hydra_events_by_session ON hydra_events (head_session_id, received_at);
CREATE INDEX hydra_events_by_tag     ON hydra_events (tag);

-- ── tx_submissions ────────────────────────────────────────────────────────────

CREATE TABLE tx_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      TEXT NOT NULL UNIQUE,
  listing_id      UUID REFERENCES listings(id),
  action          tx_action NOT NULL,
  hydra_tx_id     TEXT,
  status          submission_status NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ
);

CREATE INDEX tx_submissions_by_listing ON tx_submissions (listing_id);
CREATE INDEX tx_submissions_by_status  ON tx_submissions (status);

-- ── updated_at trigger ────────────────────────────────────────────────────────

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
