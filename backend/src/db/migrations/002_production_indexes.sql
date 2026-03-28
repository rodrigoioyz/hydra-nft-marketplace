-- Migration 002 — Production indexes for query performance (CAR-12 P2-E)

-- Standalone time-range index for hydra_events (global event feed queries)
CREATE INDEX IF NOT EXISTS hydra_events_received_at
  ON hydra_events (received_at DESC);

-- Partial index for active listings (most common query in marketplace)
CREATE INDEX IF NOT EXISTS listings_active
  ON listings (created_at DESC)
  WHERE status = 'active';

-- Index for pending tx_submissions (polled by sync workers)
CREATE INDEX IF NOT EXISTS tx_submissions_pending
  ON tx_submissions (submitted_at ASC)
  WHERE status = 'pending';
