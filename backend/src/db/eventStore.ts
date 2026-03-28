// T3.3 — Persist all Hydra events to DB
// T3.4 — Apply state projections based on event type
// T10   — State sync: catch-up via SnapshotConfirmed, contested handling, sale failure

import { Pool } from "pg";
import {
  HydraEvent,
  HeadIsOpenEvent,
  HeadIsClosedEvent,
  TxValidEvent,
  TxInvalidEvent,
  SnapshotConfirmedEvent,
  ReadyToFanoutEvent,
  HeadIsFinalizedEvent,
} from "../types/hydra";

export class EventStore {
  constructor(private readonly pool: Pool) {}

  // T3.3 — persist raw event
  async persist(event: HydraEvent, headSessionId: string | null): Promise<void> {
    const seq = ("seq" in event ? (event as { seq: number }).seq : null) as number | null;
    await this.pool.query(
      `INSERT INTO hydra_events (head_session_id, sequence, tag, payload)
       VALUES ($1, $2, $3, $4)`,
      [headSessionId, seq, event.tag, JSON.stringify(event)]
    );
  }

  // T3.4 — apply projection: update derived tables based on event
  async project(event: HydraEvent): Promise<string | null> {
    switch (event.tag) {
      case "HeadIsInitializing":
        return this.onHeadIsInitializing(event as { tag: string; headId: string });

      case "HeadIsOpen":
        return this.onHeadIsOpen(event as HeadIsOpenEvent);

      case "HeadIsClosed":
        return this.onHeadIsClosed(event as HeadIsClosedEvent);

      case "HeadIsContested":
        return this.onHeadIsContested(event as unknown as { headId: string });

      case "ReadyToFanout":
        return this.onReadyToFanout(event as ReadyToFanoutEvent);

      case "HeadIsFinalized":
        return this.onHeadIsFinalized(event as HeadIsFinalizedEvent);

      case "TxValid":
        await this.onTxValid(event as TxValidEvent);
        return null;

      case "TxInvalid":
        await this.onTxInvalid(event as TxInvalidEvent);
        return null;

      case "SnapshotConfirmed":
        await this.onSnapshotConfirmed(event as SnapshotConfirmedEvent);
        return null;

      default:
        return null;
    }
  }

  // ── Head session transitions ──────────────────────────────────────────────

  private async onHeadIsInitializing(event: { tag: string; headId: string }): Promise<string> {
    const { rows } = await this.pool.query(
      `INSERT INTO head_sessions (head_id, status)
       VALUES ($1, 'initializing')
       RETURNING id`,
      [event.headId ?? null]
    );
    const sessionId = rows[0].id as string;
    console.log(`[EventStore] HeadSession created: ${sessionId}`);
    return sessionId;
  }

  private async onHeadIsOpen(event: HeadIsOpenEvent): Promise<string | null> {
    // Update session to open, return the session ID so index.ts can track it
    const { rows } = await this.pool.query(
      `UPDATE head_sessions
       SET status = 'open', head_id = $1, opened_at = now()
       WHERE status = 'initializing'
       RETURNING id`,
      [event.headId]
    );

    if (rows.length > 0) {
      const sessionId = rows[0].id as string;
      console.log(`[EventStore] HeadSession open: ${sessionId}`);
      return sessionId;
    }

    // Head was already open (e.g. reconnect) — look up existing session
    const existing = await this.pool.query(
      `SELECT id FROM head_sessions WHERE head_id = $1 AND status = 'open' LIMIT 1`,
      [event.headId]
    );
    return existing.rows[0]?.id ?? null;
  }

  private async onHeadIsClosed(event: HeadIsClosedEvent): Promise<null> {
    await this.pool.query(
      `UPDATE head_sessions
       SET status = 'closed',
           closed_at = now(),
           contestation_deadline = $1
       WHERE status = 'open' AND head_id = $2`,
      [event.contestationDeadline, event.headId]
    );

    // All active/draft listings in this Head become failed
    await this.pool.query(
      `UPDATE listings l
       SET status = 'failed'
       FROM head_sessions s
       WHERE l.head_session_id = s.id
         AND s.head_id = $1
         AND l.status IN ('active', 'draft')`,
      [event.headId]
    );

    return null;
  }

  private async onHeadIsContested(event: { headId: string }): Promise<null> {
    await this.pool.query(
      `UPDATE head_sessions
       SET status = 'contesting'
       WHERE head_id = $1 AND status = 'closed'`,
      [event.headId]
    );
    console.log(`[EventStore] Head contesting: ${event.headId}`);
    return null;
  }

  private async onReadyToFanout(event: ReadyToFanoutEvent): Promise<null> {
    await this.pool.query(
      `UPDATE head_sessions
       SET status = 'fanout_pending'
       WHERE head_id = $1 AND status IN ('closed', 'contesting')`,
      [event.headId]
    );
    return null;
  }

  private async onHeadIsFinalized(event: HeadIsFinalizedEvent): Promise<null> {
    await this.pool.query(
      `UPDATE head_sessions
       SET status = 'finalized', finalized_at = now()
       WHERE head_id = $1`,
      [event.headId]
    );
    return null;
  }

  // ── Tx outcome projections ────────────────────────────────────────────────

  private async onTxValid(event: TxValidEvent): Promise<void> {
    const txId = event.transaction.id;
    await this.applyTxConfirmed(txId);
  }

  private async onTxInvalid(event: TxInvalidEvent): Promise<void> {
    const txId = event.transaction.id;
    const reason = event.validationError.reason;

    // Mark submission failed
    const { rows } = await this.pool.query(
      `UPDATE tx_submissions
       SET status = 'failed', error_message = $1
       WHERE hydra_tx_id = $2 AND status = 'pending'
       RETURNING listing_id, action`,
      [reason, txId]
    );

    for (const sub of rows as { listing_id: string; action: string }[]) {
      if (sub.action === "list") {
        // Revert draft listing to failed
        await this.pool.query(
          `UPDATE listings SET status = 'failed' WHERE id = $1 AND status = 'draft'`,
          [sub.listing_id]
        );
      } else if (sub.action === "buy") {
        // Revert listing back to active, fail pending sale
        await this.pool.query(
          `UPDATE listings SET status = 'active' WHERE id = $1 AND status IN ('active','sold')`,
          [sub.listing_id]
        );
        await this.pool.query(
          `UPDATE sales SET status = 'failed' WHERE listing_id = $1 AND status = 'pending'`,
          [sub.listing_id]
        );
      } else if (sub.action === "cancel") {
        // Listing stays active — cancel tx failed, seller retains listing
        console.log(`[EventStore] Cancel TxInvalid for listing ${sub.listing_id} — stays active`);
      }
    }

    console.log(`[EventStore] TxInvalid: txId=${txId} reason=${reason}`);
  }

  // T10 — SnapshotConfirmed catch-up: apply any confirmed txs we may have missed
  // (e.g. after backend restart, or if TxValid event was dropped)
  private async onSnapshotConfirmed(event: SnapshotConfirmedEvent): Promise<void> {
    const confirmedTxIds = event.snapshot.confirmedTransactions;
    if (confirmedTxIds.length === 0) return;

    // Find any pending submissions whose hydra_tx_id is in the confirmed set
    const { rows } = await this.pool.query(
      `SELECT id, listing_id, action, hydra_tx_id
       FROM tx_submissions
       WHERE hydra_tx_id = ANY($1) AND status = 'pending'`,
      [confirmedTxIds]
    );

    for (const sub of rows as { id: string; listing_id: string; action: string; hydra_tx_id: string }[]) {
      console.log(`[EventStore] SnapshotConfirmed catch-up: ${sub.action} tx ${sub.hydra_tx_id}`);
      await this.applyTxConfirmed(sub.hydra_tx_id);
    }
  }

  // Shared logic for confirming a tx — used by TxValid and SnapshotConfirmed catch-up
  private async applyTxConfirmed(txId: string): Promise<void> {
    const { rows } = await this.pool.query(
      `UPDATE tx_submissions
       SET status = 'confirmed', confirmed_at = now()
       WHERE hydra_tx_id = $1 AND status = 'pending'
       RETURNING id, listing_id, action`,
      [txId]
    );
    if (rows.length === 0) return;

    for (const sub of rows as { id: string; listing_id: string; action: string }[]) {
      if (sub.action === "list") {
        await this.pool.query(
          `UPDATE listings SET status = 'active', escrow_tx_hash = $1, escrow_utxo_ix = 0
           WHERE id = $2 AND status = 'draft'`,
          [txId, sub.listing_id]
        );
      } else if (sub.action === "buy") {
        await this.pool.query(
          `UPDATE listings SET status = 'sold' WHERE id = $1 AND status = 'active'`,
          [sub.listing_id]
        );
        await this.pool.query(
          `UPDATE sales SET status = 'confirmed', hydra_tx_id = $1, confirmed_at = now()
           WHERE listing_id = $2 AND status = 'pending'`,
          [txId, sub.listing_id]
        );
      } else if (sub.action === "cancel") {
        await this.pool.query(
          `UPDATE listings SET status = 'cancelled' WHERE id = $1 AND status = 'active'`,
          [sub.listing_id]
        );
      }
      console.log(`[EventStore] Confirmed: ${sub.action} on listing ${sub.listing_id} (tx: ${txId})`);
    }
  }
}
