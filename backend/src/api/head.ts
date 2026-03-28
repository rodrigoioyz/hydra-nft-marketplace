// GET /api/head/status — returns current head session state

import { Router } from "express";
import { asyncHandler } from "./middleware";
import type { Pool } from "pg";
import type { HydraClient } from "../hydra/client";

export function createHeadRouter(pool: Pool, hydra: HydraClient): Router {
  const router = Router();

  router.get("/status", asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM head_sessions ORDER BY created_at DESC LIMIT 1`
    );
    const session = rows[0] ?? null;

    res.json({
      sessionId:               session?.id ?? null,
      status:                  session?.status ?? hydra.getHeadStatus(),
      network:                 session?.network ?? "preprod",
      contestationPeriodSecs:  session?.contestation_period_secs ?? 600,
      openedAt:                session?.opened_at ?? null,
      closedAt:                session?.closed_at ?? null,
      contestationDeadline:    session?.contestation_deadline ?? null,
    });
  }));

  return router;
}
