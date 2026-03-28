import "dotenv/config";
import { createServer } from "http";
import { HydraClient } from "./hydra";
import { getPool, closePool, migrate, EventStore } from "./db";
import { createApp } from "./api/router";
import { config } from "./config";
import { recoverSessionId, reconcileListings } from "./sync/stateRecovery";
import type { HydraEvent, GreetingsEvent } from "./types/hydra";

async function main() {
  // Run migrations on startup
  await migrate();

  const pool       = getPool();
  const eventStore = new EventStore(pool);
  const hydra      = new HydraClient({ wsUrl: config.hydraWsUrl, httpUrl: config.hydraHttpUrl });

  // Track current head session id
  let currentSessionId: string | null = null;

  // T3.3 + T3.4 — persist every event and project state
  hydra.on("event", async (event: HydraEvent) => {
    try {
      await eventStore.persist(event, currentSessionId);
      const newSessionId = await eventStore.project(event);
      if (newSessionId) currentSessionId = newSessionId;
    } catch (err) {
      console.error("[App] Error processing event:", (err as Error).message);
    }
  });

  // T10 — On Greetings, recover session if Head is already open (backend restart)
  hydra.on("event:Greetings", async (event: GreetingsEvent) => {
    if (event.headStatus === "Open" && event.hydraHeadId) {
      try {
        const recovered = await recoverSessionId(pool, event.hydraHeadId);
        if (recovered) {
          currentSessionId = recovered;
          await reconcileListings(pool, hydra, recovered);
        }
      } catch (err) {
        console.error("[App] State recovery failed:", (err as Error).message);
      }
    }
  });

  hydra.on("connected", async () => {
    console.log("[App] Connected to Hydra node");
    try {
      const utxos    = await hydra.fetchUtxos();
      const count    = Object.keys(utxos).length;
      const totalAda = Object.values(utxos)
        .reduce((s, u) => s + (u.value.lovelace ?? 0), 0) / 1_000_000;
      console.log(`[App] Head: ${hydra.getHeadStatus()} | ${count} UTxO(s) | ${totalAda.toFixed(2)} ADA`);
    } catch {
      console.warn("[App] Could not fetch snapshot (Head may not be open)");
    }
  });

  hydra.on("event:HeadIsOpen",      () => console.log("[App] ✅ Head OPEN — trades enabled"));
  hydra.on("event:HeadIsClosed",    () => console.warn("[App] ⚠️  Head CLOSED — trades paused"));
  hydra.on("event:ReadyToFanout",   () => console.log("[App] Head ready to fanout"));
  hydra.on("event:HeadIsFinalized", () => console.log("[App] Head finalized"));
  hydra.on("disconnected",          () => console.warn("[App] Hydra disconnected — reconnecting..."));

  hydra.connect();

  // Start Express HTTP server
  const app    = createApp(pool, hydra);
  const server = createServer(app);
  server.listen(config.port, () => {
    console.log(`[App] API server listening on http://0.0.0.0:${config.port}`);
  });

  process.on("SIGINT", async () => {
    console.log("\n[App] Shutting down...");
    hydra.disconnect();
    server.close();
    await closePool();
    process.exit(0);
  });
}

main().catch(console.error);
