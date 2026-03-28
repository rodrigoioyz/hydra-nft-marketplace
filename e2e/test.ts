#!/usr/bin/env tsx
// E2E test suite for the Hydra NFT Marketplace
//
// Prerequisites:
//   1. Cardano node running (preprod)
//   2. Hydra node running (./hydra/scripts/start.sh)
//   3. Backend running (cd backend && npm run dev)
//   4. Head is OPEN and the seller address has the test NFT as a UTxO inside the Head
//
// Usage:
//   E2E_POLICY_ID=<hex> E2E_ASSET_NAME=<hex> npx tsx e2e/test.ts
//
// All env vars are in e2e/config.ts

import { E2E }              from "./config";
import {
  apiGet,
  apiPost,
  newRequestId,
  signTx,
  runTest,
  printSummary,
  assert,
  sleep,
  type TestResult,
} from "./helpers";

const BOLD  = "\x1b[1m";
const CYAN  = "\x1b[36m";
const RESET = "\x1b[0m";

// ── Type stubs for API responses ──────────────────────────────────────────────

interface HealthResponse { ok: boolean; db: string; hydra: string; headStatus: string }
interface HeadStatusResponse { status: string; sessionId: string | null }
interface Listing {
  id: string; status: string; priceLovelace: string;
  escrowTxHash: string | null; sale?: { status: string } | null;
}
interface ListingsResponse { listings: Listing[]; total: number }
interface CreateListingResponse { listingId: string; escrowTxCbor: string; txId: string }
interface EscrowConfirmResponse { submissionId: string; status: string }
interface BuyResponse { saleId: string; hydraTxId: string; status: string }
interface CancelTxResponse { unsignedTxCbor: string; txId: string }
interface CancelResponse { submissionId: string; status: string }
interface StatsResponse {
  listings: Record<string, number>;
  sales:    Record<string, number>;
  headStatus: string;
}

// ── Test flows ────────────────────────────────────────────────────────────────

async function testHealth(): Promise<void> {
  const h = await apiGet<HealthResponse>("/health");
  assert(h.db    === "ok",        `DB not ok: ${h.db}`);
  assert(h.hydra === "connected", `Hydra not connected: ${h.hydra}`);
  assert(h.ok,                    `Health not ok: ${JSON.stringify(h)}`);
}

async function testHeadOpen(): Promise<void> {
  const h = await apiGet<HeadStatusResponse>("/head/status");
  assert(
    h.status === "open" || h.status === "Open",
    `Head is not open — status: ${h.status}. Start/open the Hydra Head first.`
  );
}

async function testListings(): Promise<void> {
  const r = await apiGet<ListingsResponse>("/listings");
  assert(typeof r.total === "number", "Missing total field");
  assert(Array.isArray(r.listings),   "Missing listings array");
}

async function testAdminStats(): Promise<void> {
  const s = await apiGet<StatsResponse>("/admin/stats", E2E.adminKey);
  assert(typeof s.listings   === "object", "Missing listings in stats");
  assert(typeof s.headStatus === "string", "Missing headStatus in stats");
}

// Full flow: create listing → sign escrow → activate → buy → verify sold
async function testListAndBuyFlow(): Promise<void> {
  if (!E2E.testPolicyId || !E2E.testAssetName) {
    throw new Error(
      "Set E2E_POLICY_ID and E2E_ASSET_NAME to run the list+buy flow.\n" +
      "    The test NFT must be inside the Hydra Head snapshot."
    );
  }

  const priceLovelace = String(E2E.testPriceAda * 1_000_000);

  // Step 1: Create listing (draft)
  const created = await apiPost<CreateListingResponse>("/listings", {
    requestId:     newRequestId(),
    sellerAddress: E2E.sellerAddress,
    policyId:      E2E.testPolicyId,
    assetName:     E2E.testAssetName,
    priceLovelace,
  });
  const listingId = created.listingId;
  assert(typeof listingId === "string" && listingId.length > 0, "No listingId returned");
  assert(typeof created.escrowTxCbor === "string",              "No escrowTxCbor returned");

  // Step 2: Sign the escrow tx offline (cardano-cli)
  const signedEscrowCbor = signTx(created.escrowTxCbor);
  assert(signedEscrowCbor.length > 0, "Signing returned empty CBOR");

  // Step 3: Submit signed escrow → listing becomes active
  const confirmed = await apiPost<EscrowConfirmResponse>(
    `/listings/${listingId}/escrow-confirm`,
    { signedTxCbor: signedEscrowCbor, txId: created.txId }
  );
  assert(confirmed.submissionId.length > 0, "No submissionId");

  // Wait for TxValid + SnapshotConfirmed to propagate
  await sleep(3000);

  // Verify listing is now active
  const listing = await apiGet<Listing>(`/listings/${listingId}`);
  assert(
    listing.status === "active",
    `Expected active, got ${listing.status} — Hydra may not have confirmed yet`
  );

  // Step 4: Buy the listing (operator signs internally)
  const bought = await apiPost<BuyResponse>(`/listings/${listingId}/buy`, {
    requestId:    newRequestId(),
    buyerAddress: E2E.sellerAddress, // use same addr as buyer in tests
  });
  assert(typeof bought.hydraTxId === "string", "No hydraTxId returned");

  // Wait for buy tx confirmation
  await sleep(3000);

  // Verify sold
  const afterBuy = await apiGet<Listing>(`/listings/${listingId}`);
  assert(
    afterBuy.status === "sold",
    `Expected sold, got ${afterBuy.status}`
  );
  assert(
    afterBuy.sale?.status === "confirmed" || afterBuy.sale?.status === "pending",
    `Sale status unexpected: ${afterBuy.sale?.status}`
  );
}

// Flow: create listing → sign escrow → activate → cancel → verify cancelled
async function testListAndCancelFlow(): Promise<void> {
  if (!E2E.testPolicyId || !E2E.testAssetName) {
    throw new Error("Set E2E_POLICY_ID and E2E_ASSET_NAME to run the list+cancel flow.");
  }

  const priceLovelace = String((E2E.testPriceAda + 1) * 1_000_000); // different price from buy test

  // Step 1: Create listing
  const created = await apiPost<CreateListingResponse>("/listings", {
    requestId:     newRequestId(),
    sellerAddress: E2E.sellerAddress,
    policyId:      E2E.testPolicyId,
    assetName:     E2E.testAssetName,
    priceLovelace,
  });
  const listingId = created.listingId;

  // Step 2: Sign + confirm escrow
  const signedEscrowCbor = signTx(created.escrowTxCbor);
  await apiPost<EscrowConfirmResponse>(
    `/listings/${listingId}/escrow-confirm`,
    { signedTxCbor: signedEscrowCbor, txId: created.txId }
  );

  await sleep(3000);

  const listing = await apiGet<Listing>(`/listings/${listingId}`);
  assert(listing.status === "active", `Expected active, got ${listing.status}`);

  // Step 3: Fetch unsigned cancel tx
  const cancelTx = await apiGet<CancelTxResponse>(`/listings/${listingId}/cancel-tx`);
  assert(typeof cancelTx.unsignedTxCbor === "string", "No unsignedTxCbor");

  // Step 4: Sign cancel tx
  const signedCancelCbor = signTx(cancelTx.unsignedTxCbor);

  // Step 5: Submit cancel
  const cancelled = await apiPost<CancelResponse>(`/listings/${listingId}/cancel`, {
    requestId:          newRequestId(),
    sellerAddress:      E2E.sellerAddress,
    signedCancelTxCbor: signedCancelCbor,
    txId:               cancelTx.txId,
  });
  assert(cancelled.submissionId.length > 0, "No submissionId");

  await sleep(3000);

  // Verify cancelled
  const afterCancel = await apiGet<Listing>(`/listings/${listingId}`);
  assert(
    afterCancel.status === "cancelled",
    `Expected cancelled, got ${afterCancel.status}`
  );
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}Hydra NFT Marketplace — E2E Test Suite${RESET}`);
  console.log(`API: ${E2E.apiBase}`);
  console.log(`Seller: ${E2E.sellerAddress}`);
  if (E2E.testPolicyId) {
    console.log(`NFT: ${E2E.testPolicyId}.${E2E.testAssetName}`);
  } else {
    console.log(`NFT: ${BOLD}[not set — list/buy/cancel flows will be skipped]${RESET}`);
  }
  console.log("");

  const results: TestResult[] = [];

  // ── Infrastructure checks
  console.log(`${BOLD}Infrastructure${RESET}`);
  results.push(await runTest("Health endpoint returns ok",          testHealth));
  results.push(await runTest("Hydra Head is open",                  testHeadOpen));
  results.push(await runTest("GET /listings returns valid response", testListings));
  results.push(await runTest("Admin stats endpoint (X-Admin-Key)",  testAdminStats));

  // ── Business flows (require NFT in Head)
  console.log(`\n${BOLD}Business flows${RESET}`);
  results.push(await runTest("List NFT + buy flow",    testListAndBuyFlow));
  results.push(await runTest("List NFT + cancel flow", testListAndCancelFlow));

  printSummary(results);

  const anyFailed = results.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
