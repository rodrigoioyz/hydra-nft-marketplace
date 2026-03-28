-- Migration 003 — Farmer identity: KYC registrations + crop mint records

-- ── Types ─────────────────────────────────────────────────────────────────────

CREATE TYPE farmer_status AS ENUM ('pending', 'approved', 'rejected');

-- ── farmer_registrations ──────────────────────────────────────────────────────
-- One row per farmer KYC submission.
-- identity_hash = sha256("nombre:documento") computed in-browser — PII never stored.
-- company_name is public (shown on listings).
-- farmer_pass_tx_hash is set once the operator mints the FarmerPass NFT on L1.

CREATE TABLE farmer_registrations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address       TEXT NOT NULL UNIQUE,
  company_name         TEXT NOT NULL,
  identity_hash        TEXT NOT NULL,         -- hex sha256("nombre:documento")
  status               farmer_status NOT NULL DEFAULT 'pending',
  farmer_pass_tx_hash  TEXT,                  -- L1 mint tx; NULL until approved+minted
  reviewed_by          TEXT,                  -- operator wallet address
  reviewed_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX farmer_registrations_by_status  ON farmer_registrations (status);
CREATE INDEX farmer_registrations_by_address ON farmer_registrations (wallet_address);

CREATE TRIGGER farmer_registrations_updated_at
  BEFORE UPDATE ON farmer_registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── crop_mints ────────────────────────────────────────────────────────────────
-- One row per crop token mint request (inside the Hydra Head).
-- Records the intent; tx_hash filled once confirmed on-chain.

CREATE TABLE crop_mints (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_address   TEXT NOT NULL REFERENCES farmer_registrations (wallet_address),
  crop_name        TEXT NOT NULL,             -- plain text, e.g. "Arroz"
  asset_name_hex   TEXT NOT NULL,             -- UTF-8 hex of crop_name
  quantity         BIGINT NOT NULL CHECK (quantity > 0),
  price_lovelace   BIGINT NOT NULL CHECK (price_lovelace > 0),
  tx_hash          TEXT,                      -- L2 mint tx; NULL until submitted
  status           submission_status NOT NULL DEFAULT 'pending',
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ
);

CREATE INDEX crop_mints_by_farmer ON crop_mints (farmer_address);
CREATE INDEX crop_mints_by_status ON crop_mints (status);
