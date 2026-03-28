import express, { Router, Request, Response, NextFunction } from "express";
import { createListingsRouter } from "./listings";
import { createHeadRouter } from "./head";
import { createAdminRouter } from "./admin";
import { createHealthRouter } from "./health";
import { errorHandler, apiError, requestLogger } from "./middleware";
import { config } from "../config";
import type { Pool } from "pg";
import type { HydraClient } from "../hydra/client";

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-admin-key"] as string | undefined;
  if (key !== config.adminSecret) {
    apiError(res, 401, "UNAUTHORIZED", "Missing or invalid X-Admin-Key header");
    return;
  }
  next();
}

export function createApp(pool: Pool, hydra: HydraClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use(requestLogger());

  const api = Router();
  api.use("/health",   createHealthRouter(pool, hydra));
  api.use("/listings", createListingsRouter(pool, hydra));
  api.use("/head",     createHeadRouter(pool, hydra));
  api.use("/admin",    adminAuth, createAdminRouter(pool, hydra));

  app.use("/api", api);
  app.use(errorHandler);

  return app;
}
