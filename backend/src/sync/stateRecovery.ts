// T10 — Session recovery and listing reconciliation on backend restart

import type { Pool } from "pg";
import type { HydraClient } from "../hydra/client";

/**
 * On startup, if the Hydra Head is already open, recover the active
 * head_session id from the DB so event persistence is correctly linked.
 */
export async function recoverSessionId(
  pool: Pool,
  headId: string | null
): Promise<string | null> {
  if (!headId) return null;

  const { rows } = await pool.query(
    `SELECT id FROM head_sessions
     WHERE head_id = $1 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [headId]
  );

  if (rows.length > 0) {
    const sessionId = rows[0].id as string;
    console.log(`[StateRecovery] Recovered head session: ${sessionId} (head: ${headId})`);
    return sessionId;
  }

  console.warn(`[StateRecovery] No open session found for head: ${headId}`);
  return null;
}

/**
 * T10 — Reconcile listing states after a backend restart.
 *
 * After reconnect, the latest SnapshotConfirmed confirmedTransactions list
 * is the ground truth for what txs are finalised inside the Head.
 * Any tx_submission that is still 'pending' but whose hydra_tx_id appears
 * in confirmedTxIds should be promoted to 'confirmed'.
 *
 * Any 'active' listing whose escrow_tx_hash is NOT in the confirmed set
 * (i.e. the Head snapshot no longer contains it) is marked 'failed'.
 */
export async function reconcileListings(
  pool: Pool,
  hydra: HydraClient,
  sessionId: string
): Promise<void> {
  // Fetch current Head snapshot
  let utxos: Record<string, unknown>;
  try {
    utxos = await hydra.fetchUtxos();
  } catch (err) {
    console.warn("[StateRecovery] Could not fetch UTxOs for reconciliation:", (err as Error).message);
    return;
  }

  // Collect all tx hashes present in the snapshot
  const snapshotTxHashes = new Set<string>();
  for (const ref of Object.keys(utxos)) {
    const txHash = ref.split("#")[0];
    if (txHash) snapshotTxHashes.add(txHash);
  }

  console.log(`[StateRecovery] Snapshot has ${snapshotTxHashes.size} unique tx hashes`);

  // Find all pending tx_submissions for this session
  const { rows: pending } = await pool.query(
    `SELECT ts.id, ts.hydra_tx_id, ts.listing_id, ts.action
     FROM tx_submissions ts
     JOIN listings l ON l.id = ts.listing_id
     WHERE l.head_session_id = $1 AND ts.status = 'pending'`,
    [sessionId]
  );

  for (const sub of pending as { id: string; hydra_tx_id: string; listing_id: string; action: string }[]) {
    if (snapshotTxHashes.has(sub.hydra_tx_id)) {
      // Tx is confirmed in snapshot — promote it
      await pool.query(
        `UPDATE tx_submissions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [sub.id]
      );
      if (sub.action === "list") {
        await pool.query(
          `UPDATE listings SET status = 'active', escrow_tx_hash = $1, escrow_utxo_ix = 0
           WHERE id = $2 AND status = 'draft'`,
          [sub.hydra_tx_id, sub.listing_id]
        );
      } else if (sub.action === "buy") {
        await pool.query(`UPDATE listings SET status = 'sold' WHERE id = $1 AND status = 'active'`, [sub.listing_id]);
        await pool.query(
          `UPDATE sales SET status = 'confirmed', hydra_tx_id = $1, confirmed_at = now()
           WHERE listing_id = $2 AND status = 'pending'`,
          [sub.hydra_tx_id, sub.listing_id]
        );
      } else if (sub.action === "cancel") {
        await pool.query(`UPDATE listings SET status = 'cancelled' WHERE id = $1 AND status = 'active'`, [sub.listing_id]);
      }
      console.log(`[StateRecovery] Promoted ${sub.action} tx ${sub.hydra_tx_id} → confirmed`);
    }
  }

  // Mark active listings whose escrow UTxO is no longer in the snapshot as failed
  const { rows: activeListings } = await pool.query(
    `SELECT id, escrow_tx_hash FROM listings
     WHERE head_session_id = $1 AND status = 'active' AND escrow_tx_hash IS NOT NULL`,
    [sessionId]
  );

  for (const listing of activeListings as { id: string; escrow_tx_hash: string }[]) {
    if (!snapshotTxHashes.has(listing.escrow_tx_hash)) {
      await pool.query(`UPDATE listings SET status = 'failed' WHERE id = $1`, [listing.id]);
      console.warn(`[StateRecovery] Listing ${listing.id} escrow tx missing from snapshot — marked failed`);
    }
  }

  console.log("[StateRecovery] Reconciliation complete");
}
