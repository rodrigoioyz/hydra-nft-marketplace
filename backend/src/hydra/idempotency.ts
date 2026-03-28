// T2.5 — Idempotency layer for tx submissions
// Prevents duplicate NewTx submissions using requestId keys

interface Submission {
  requestId: string;
  txId: string | null;
  status: "pending" | "confirmed" | "failed";
  createdAt: Date;
  error?: string;
}

export class IdempotencyStore {
  private store = new Map<string, Submission>();

  has(requestId: string): boolean {
    return this.store.has(requestId);
  }

  get(requestId: string): Submission | undefined {
    return this.store.get(requestId);
  }

  // Register a new submission — throws if requestId already used
  register(requestId: string): void {
    if (this.store.has(requestId)) {
      throw new DuplicateRequestError(requestId, this.store.get(requestId)!);
    }
    this.store.set(requestId, {
      requestId,
      txId: null,
      status: "pending",
      createdAt: new Date(),
    });
  }

  setTxId(requestId: string, txId: string): void {
    const entry = this.store.get(requestId);
    if (entry) entry.txId = txId;
  }

  confirm(requestId: string): void {
    const entry = this.store.get(requestId);
    if (entry) entry.status = "confirmed";
  }

  fail(requestId: string, error: string): void {
    const entry = this.store.get(requestId);
    if (entry) { entry.status = "failed"; entry.error = error; }
  }

  // Evict entries older than ttlMs (default 1 hour) to prevent memory growth
  evictOlderThan(ttlMs = 3_600_000): void {
    const cutoff = Date.now() - ttlMs;
    for (const [key, entry] of this.store) {
      if (entry.createdAt.getTime() < cutoff && entry.status !== "pending") {
        this.store.delete(key);
      }
    }
  }
}

export class DuplicateRequestError extends Error {
  constructor(
    public readonly requestId: string,
    public readonly existing: Submission
  ) {
    super(`Duplicate requestId: ${requestId} (status=${existing.status})`);
    this.name = "DuplicateRequestError";
  }
}
