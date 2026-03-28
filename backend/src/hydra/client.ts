// T2.1 + T2.2 + T2.3 + T2.4 — Hydra WebSocket client
// Handles: connection, reconnect, event ingestion, UTxO cache, NewTx submission

import WebSocket from "ws";
import { EventEmitter } from "events";
import {
  HydraEvent,
  HydraCommand,
  UtxoSet,
  HeadStatus,
  TxValidEvent,
  TxInvalidEvent,
  HeadIsOpenEvent,
  SnapshotConfirmedEvent,
  HeadIsClosedEvent,
  HeadIsFinalizedEvent,
  GreetingsEvent,
} from "../types/hydra";

export interface HydraClientConfig {
  wsUrl: string;
  httpUrl: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

export class HydraClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private utxoCache: UtxoSet = {};
  private headStatus: HeadStatus = "Idle";
  private headId: string | null = null;
  private isConnected = false;
  private isStopped = false;

  constructor(private readonly config: HydraClientConfig) {
    super();
    this.config.reconnectDelayMs ??= 3000;
    this.config.maxReconnectAttempts ??= Infinity;
  }

  // ── Connection ────────────────────────────────────────────────────────────

  connect(): void {
    if (this.isStopped) return;

    console.log(`[HydraClient] Connecting to ${this.config.wsUrl}...`);
    this.ws = new WebSocket(this.config.wsUrl);

    this.ws.on("open", () => {
      console.log("[HydraClient] Connected");
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit("connected");
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      this.isConnected = false;
      console.log(`[HydraClient] Disconnected (code=${code} reason=${reason})`);
      this.emit("disconnected", { code, reason: reason.toString() });
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[HydraClient] WebSocket error:", err.message);
      this.emit("error", err);
    });
  }

  disconnect(): void {
    this.isStopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isStopped) return;
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts ?? Infinity)) {
      console.error("[HydraClient] Max reconnect attempts reached");
      this.emit("maxReconnectReached");
      return;
    }

    const delay = this.config.reconnectDelayMs! * Math.min(2 ** this.reconnectAttempts, 10);
    this.reconnectAttempts++;
    console.log(`[HydraClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Event ingestion (T2.2) ────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let event: HydraEvent;
    try {
      event = JSON.parse(raw) as HydraEvent;
    } catch {
      console.warn("[HydraClient] Unparseable message:", raw.slice(0, 100));
      return;
    }

    // Log all events (raw)
    console.log(`[HydraClient] EVENT ${event.tag}`, this.summarize(event));

    // Update internal state
    this.applyEvent(event);

    // Emit for external handlers
    this.emit("event", event);
    this.emit(`event:${event.tag}`, event);
  }

  private applyEvent(event: HydraEvent): void {
    switch (event.tag) {
      case "Greetings": {
        const e = event as GreetingsEvent;
        this.headStatus = e.headStatus;
        this.headId = e.hydraHeadId ?? null;
        console.log(`[HydraClient] headStatus=${this.headStatus} headId=${this.headId ?? "none"}`);
        break;
      }
      case "HeadIsOpen": {
        const e = event as HeadIsOpenEvent;
        this.headStatus = "Open";
        this.headId = e.headId;
        this.utxoCache = { ...e.utxo };
        console.log(`[HydraClient] Head OPEN. UTxOs: ${Object.keys(this.utxoCache).length}`);
        break;
      }
      case "SnapshotConfirmed": {
        // T2.3 — update UTxO cache on every confirmed snapshot
        const e = event as SnapshotConfirmedEvent;
        this.utxoCache = { ...e.snapshot.utxo };
        console.log(`[HydraClient] Snapshot #${e.snapshot.number}. UTxOs: ${Object.keys(this.utxoCache).length}`);
        break;
      }
      case "HeadIsClosed": {
        const e = event as HeadIsClosedEvent;
        this.headStatus = "Closed";
        console.log(`[HydraClient] Head CLOSED. Deadline: ${e.contestationDeadline}`);
        break;
      }
      case "ReadyToFanout":
        this.headStatus = "FanoutPossible";
        break;

      case "HeadIsFinalized": {
        const e = event as HeadIsFinalizedEvent;
        this.headStatus = "Final";
        this.utxoCache = {};
        void e; // suppress unused warning
        break;
      }
    }
  }

  private summarize(event: HydraEvent): string {
    switch (event.tag) {
      case "TxValid": {
        const e = event as TxValidEvent;
        return `txId=${e.transaction.id}`;
      }
      case "TxInvalid": {
        const e = event as TxInvalidEvent;
        return `txId=${e.transaction.id} reason=${e.validationError.reason}`;
      }
      case "SnapshotConfirmed": {
        const e = event as SnapshotConfirmedEvent;
        return `snapshot=#${e.snapshot.number}`;
      }
      default: return "";
    }
  }

  // ── UTxO cache (T2.3) ─────────────────────────────────────────────────────

  getUtxos(): UtxoSet {
    return { ...this.utxoCache };
  }

  async fetchUtxos(): Promise<UtxoSet> {
    const res = await fetch(`${this.config.httpUrl}/snapshot/utxo`);
    if (!res.ok) throw new Error(`GET /snapshot/utxo failed: ${res.status}`);
    const utxos = await res.json() as UtxoSet;
    this.utxoCache = { ...utxos };
    return utxos;
  }

  // ── NewTx submission (T2.4) ───────────────────────────────────────────────

  sendCommand(command: HydraCommand): void {
    if (!this.ws || !this.isConnected) {
      throw new Error("HydraClient not connected");
    }
    this.ws.send(JSON.stringify(command));
  }

  submitTx(cborHex: string, type = "Tx ConwayEra"): void {
    this.sendCommand({
      tag: "NewTx",
      transaction: { cborHex, description: "", type },
    });
  }

  // Wait for TxValid or TxInvalid for a specific tx
  async awaitTxConfirmation(
    txId: string,
    timeoutMs = 30_000
  ): Promise<TxValidEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for tx ${txId}`));
      }, timeoutMs);

      const onValid = (event: TxValidEvent) => {
        if (event.transaction.id === txId) { cleanup(); resolve(event); }
      };
      const onInvalid = (event: TxInvalidEvent) => {
        if (event.transaction.id === txId) {
          cleanup();
          reject(new Error(`TxInvalid: ${event.validationError.reason}`));
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off("event:TxValid", onValid);
        this.off("event:TxInvalid", onInvalid);
      };

      this.on("event:TxValid", onValid);
      this.on("event:TxInvalid", onInvalid);
    });
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getHeadStatus(): HeadStatus { return this.headStatus; }
  getHeadId(): string | null   { return this.headId; }
  isOpen(): boolean            { return this.headStatus === "Open"; }
  connected(): boolean         { return this.isConnected; }

  closeHead(): void  { this.sendCommand({ tag: "Close" }); }
  fanout(): void     { this.sendCommand({ tag: "Fanout" }); }
}
