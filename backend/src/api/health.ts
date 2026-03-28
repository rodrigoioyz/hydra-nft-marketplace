// GET /api/health — liveness + readiness probe

import { Router } from "express";
import { asyncHandler } from "./middleware";
import type { Pool } from "pg";
import type { HydraClient } from "../hydra/client";

const startedAt = new Date().toISOString();

export function createHealthRouter(pool: Pool, hydra: HydraClient): Router {
  const router = Router();

  router.get("/", asyncHandler(async (_req, res) => {
    // DB liveness: cheap ping
    let dbOk = false;
    try {
      await pool.query("SELECT 1");
      dbOk = true;
    } catch { /* db down */ }

    const hydraOk  = hydra.connected();
    const headOpen = hydra.isOpen();
    const ok       = dbOk && hydraOk;

    res.status(ok ? 200 : 503).json({
      ok,
      uptime:    process.uptime(),
      startedAt,
      db:        dbOk    ? "ok" : "error",
      hydra:     hydraOk ? "connected" : "disconnected",
      headStatus: hydra.getHeadStatus(),
      headOpen,
    });
  }));

  return router;
}
