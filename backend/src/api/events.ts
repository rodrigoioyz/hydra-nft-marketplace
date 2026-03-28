// GET /api/events — Server-Sent Events relay for Hydra events (CAR-10)
// Pushes real-time Hydra node events to browser clients.

import { Router, Request, Response } from "express";
import type { HydraClient } from "../hydra/client";
import type { HydraEvent } from "../types/hydra";

// Tags we relay to the browser (excludes verbose snapshot/UTxO dumps)
const RELAY_TAGS = new Set([
  "HeadIsOpen",
  "HeadIsClosed",
  "HeadIsFinalized",
  "HeadIsInitializing",
  "HeadIsContested",
  "ReadyToFanout",
  "TxValid",
  "TxInvalid",
  "SnapshotConfirmed",
  "Committed",
  "Greetings",
]);

type SseClient = {
  id: number;
  res: Response;
};

let nextClientId = 1;

export function createEventsRouter(hydra: HydraClient): Router {
  const router = Router();
  const clients: Map<number, SseClient> = new Map();

  // Relay Hydra events to all connected SSE clients
  const onHydraEvent = (event: HydraEvent) => {
    if (!RELAY_TAGS.has(event.tag)) return;
    const data = JSON.stringify({ type: event.tag, payload: event, ts: Date.now() });
    for (const client of clients.values()) {
      client.res.write(`data: ${data}\n\n`);
    }
  };

  const onConnected = () => {
    const data = JSON.stringify({ type: "hydra:connected", ts: Date.now() });
    for (const client of clients.values()) {
      client.res.write(`data: ${data}\n\n`);
    }
  };

  const onDisconnected = () => {
    const data = JSON.stringify({ type: "hydra:disconnected", ts: Date.now() });
    for (const client of clients.values()) {
      client.res.write(`data: ${data}\n\n`);
    }
  };

  hydra.on("event", onHydraEvent);
  hydra.on("connected", onConnected);
  hydra.on("disconnected", onDisconnected);

  router.get("/", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();

    const id = nextClientId++;
    clients.set(id, { id, res });

    // Send current head status immediately on connect
    const status = JSON.stringify({
      type: "hydra:status",
      headStatus: hydra.getHeadStatus(),
      connected: hydra.connected(),
      ts: Date.now(),
    });
    res.write(`data: ${status}\n\n`);

    // Heartbeat ping every 30s to keep the connection alive through proxies
    const pingInterval = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 30_000);

    req.on("close", () => {
      clearInterval(pingInterval);
      clients.delete(id);
    });
  });

  return router;
}
