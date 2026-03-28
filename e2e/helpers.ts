// E2E helpers: HTTP client + cardano-cli signing

import { execSync, spawnSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { E2E } from "./config";

// ── HTTP ─────────────────────────────────────────────────────────────────────

export async function apiGet<T>(path: string, adminKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (adminKey) headers["x-admin-key"] = adminKey;
  const res = await fetch(`${E2E.apiBase}${path}`, { headers });
  const data = await res.json() as T;
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function apiPost<T>(path: string, body: unknown, adminKey?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (adminKey) headers["x-admin-key"] = adminKey;
  const res = await fetch(`${E2E.apiBase}${path}`, {
    method:  "POST",
    headers,
    body:    JSON.stringify(body),
  });
  const data = await res.json() as T;
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export function newRequestId(): string { return randomUUID(); }

// ── Cardano-CLI signing ───────────────────────────────────────────────────────

/**
 * Sign an unsigned transaction CBOR using cardano-cli.
 * Writes temp files, calls `transaction sign`, reads back the signed CBOR.
 */
export function signTx(unsignedCborHex: string): string {
  const id  = randomUUID().slice(0, 8);
  const dir = tmpdir();
  const unsignedPath = join(dir, `e2e-unsigned-${id}.tx`);
  const signedPath   = join(dir, `e2e-signed-${id}.tx`);

  // Write unsigned tx in cardano-cli envelope format
  const envelope = JSON.stringify({
    type:        "Tx ConwayEra",
    description: "",
    cborHex:     unsignedCborHex,
  });
  writeFileSync(unsignedPath, envelope, "utf8");

  try {
    const result = spawnSync(
      E2E.cardanoCliPath,
      [
        "latest", "transaction", "sign",
        "--tx-file",          unsignedPath,
        "--signing-key-file", E2E.skeyPath,
        "--testnet-magic",    "1",
        "--out-file",         signedPath,
      ],
      { encoding: "utf8" }
    );

    if (result.status !== 0) {
      throw new Error(`cardano-cli sign failed: ${result.stderr}`);
    }

    const signed = JSON.parse(readFileSync(signedPath, "utf8")) as { cborHex: string };
    return signed.cborHex;
  } finally {
    try { unlinkSync(unsignedPath); } catch { /* ignore */ }
    try { unlinkSync(signedPath);   } catch { /* ignore */ }
  }
}

/**
 * Derive the tx ID from a signed CBOR using cardano-cli.
 */
export function getTxId(signedCborHex: string): string {
  const id  = randomUUID().slice(0, 8);
  const path = join(tmpdir(), `e2e-txid-${id}.tx`);
  writeFileSync(path, JSON.stringify({ type: "Tx ConwayEra", description: "", cborHex: signedCborHex }));
  try {
    const raw = execSync(
      `${E2E.cardanoCliPath} latest transaction txid --tx-file ${path}`,
      { encoding: "utf8" }
    ).trim();
    // cardano-cli 10+ returns JSON: {"txhash":"..."}
    try { return (JSON.parse(raw) as { txhash: string }).txhash; } catch { return raw; }
  } finally {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────

const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

export type TestResult = { name: string; passed: boolean; error?: string; durationMs: number };

export async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ${GREEN}✓${RESET} ${name} ${YELLOW}(${ms}ms)${RESET}`);
    return { name, passed: true, durationMs: ms };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${RED}✗${RESET} ${name} ${YELLOW}(${ms}ms)${RESET}`);
    console.log(`    ${RED}${msg}${RESET}`);
    return { name, passed: false, error: msg, durationMs: ms };
  }
}

export function printSummary(results: TestResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const total  = results.length;
  console.log("");
  console.log(`${BOLD}Results: ${passed}/${total} passed${RESET}`);
  if (failed > 0) {
    console.log(`${RED}${failed} failed:${RESET}`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ${RED}✗ ${r.name}${RESET}`);
      if (r.error) console.log(`    ${r.error}`);
    }
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
