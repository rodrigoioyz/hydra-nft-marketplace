// Admin / observability endpoints
// GET  /api/admin/events          — recent hydra_events (last 100)
// GET  /api/admin/tx-submissions  — all tx_submissions (with filters)
// POST /api/admin/head/close      — initiate Head close
// POST /api/admin/head/fanout     — initiate fanout after contestation deadline

import { Router } from "express";
import type { Pool } from "pg";
import type { HydraClient } from "../hydra/client";
import { asyncHandler, apiError } from "./middleware";

export function createAdminRouter(pool: Pool, hydra: HydraClient): Router {
  const router = Router();

  // GET /api/admin/events?limit=100&tag=TxValid
  router.get(
    "/events",
    asyncHandler(async (req, res) => {
      const limit  = Math.min(Number(req.query["limit"] ?? 100), 500);
      const tag    = req.query["tag"] as string | undefined;
      const params: unknown[] = [limit];
      const where  = tag ? `WHERE tag = $2` : "";
      if (tag) params.push(tag);

      const { rows } = await pool.query(
        `SELECT id, head_session_id, sequence, tag, payload, created_at
         FROM hydra_events
         ${where}
         ORDER BY created_at DESC
         LIMIT $1`,
        params
      );
      res.json({ events: rows, count: rows.length });
    })
  );

  // GET /api/admin/tx-submissions?status=pending&listingId=...
  router.get(
    "/tx-submissions",
    asyncHandler(async (req, res) => {
      const status    = req.query["status"]    as string | undefined;
      const listingId = req.query["listingId"] as string | undefined;
      const conditions: string[] = [];
      const params:     unknown[] = [];

      if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (listingId) {
        params.push(listingId);
        conditions.push(`listing_id = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT id, listing_id, action, hydra_tx_id, status, error_message, submitted_at, confirmed_at
         FROM tx_submissions
         ${where}
         ORDER BY submitted_at DESC
         LIMIT 200`,
        params
      );
      res.json({ submissions: rows, count: rows.length });
    })
  );

  // POST /api/admin/head/close — tell Hydra node to close the Head
  router.post(
    "/head/close",
    asyncHandler(async (_req, res) => {
      if (hydra.getHeadStatus() !== "Open") {
        return apiError(res, 409, "HEAD_NOT_OPEN", "Head is not open");
      }
      hydra.closeHead();
      res.json({ ok: true, message: "Close initiated" });
    })
  );

  // POST /api/admin/head/fanout — trigger fanout
  router.post(
    "/head/fanout",
    asyncHandler(async (_req, res) => {
      const status = hydra.getHeadStatus();
      if (status !== "FanoutPossible") {
        return apiError(res, 409, "FANOUT_NOT_READY", `Head status is ${status}, expected FanoutPossible`);
      }
      hydra.fanout();
      res.json({ ok: true, message: "Fanout initiated" });
    })
  );

  // GET /api/admin/stats — aggregate counts for monitoring
  router.get(
    "/stats",
    asyncHandler(async (_req, res) => {
      const [listings, sales, events, sessions] = await Promise.all([
        pool.query(
          `SELECT status, COUNT(*) AS count FROM listings GROUP BY status`
        ),
        pool.query(
          `SELECT status, COUNT(*) AS count FROM sales GROUP BY status`
        ),
        pool.query(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS last_hour
           FROM hydra_events`
        ),
        pool.query(
          `SELECT status, COUNT(*) AS count FROM head_sessions GROUP BY status`
        ),
      ]);

      const toMap = (rows: { status: string; count: string }[]) =>
        Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));

      res.json({
        listings:    toMap(listings.rows),
        sales:       toMap(sales.rows),
        headSessions: toMap(sessions.rows),
        events: {
          total:    Number(events.rows[0]?.total    ?? 0),
          lastHour: Number(events.rows[0]?.last_hour ?? 0),
        },
        headStatus:  hydra.getHeadStatus(),
        hydraConnected: hydra.connected(),
      });
    })
  );

  return router;
}
