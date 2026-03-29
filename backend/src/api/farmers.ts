// POST /api/farmers/register           — submit KYC
// GET  /api/farmers/status/:addr       — check own registration status
// POST /api/crops/build-mint-tx        — build unsigned L1 CropToken mint tx
// POST /api/crops/submit-mint-tx       — submit farmer-signed L1 tx + update DB
// GET  /api/crops/:addr                — list crop mints for a farmer

import { Router } from "express";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { asyncHandler, apiError } from "./middleware";
import { FarmerRepo } from "../db/farmerRepo";
import { buildCropMintTxUnsigned, submitL1Tx, getL1Scripts, queryL1Utxos, queryL1UtxosFull } from "../tx/l1mint";
import { getPaymentKeyHash } from "../utils/address";
import { config } from "../config";
import type { Pool } from "pg";

function toApiFarmer(row: import("../db/farmerRepo").FarmerRow) {
  return {
    id:                row.id,
    walletAddress:     row.wallet_address,
    companyName:       row.company_name,
    status:            row.status,
    farmerPassTxHash:  row.farmer_pass_tx_hash,
    createdAt:         row.created_at,
  };
}

function toApiCropMint(row: import("../db/farmerRepo").CropMintRow) {
  return {
    id:             row.id,
    cropName:       row.crop_name,
    assetNameHex:   row.asset_name_hex,
    quantity:       Number(row.quantity),
    priceLovelace:  row.price_lovelace,
    txHash:         row.tx_hash,
    status:         row.status,
    confirmedAt:    row.confirmed_at,
    createdAt:      row.created_at,
  };
}

export function createFarmersRouter(pool: Pool): Router {
  const router = Router();
  const repo   = new FarmerRepo(pool);

  // ── POST /farmers/register ─────────────────────────────────────────────────
  router.post("/register", asyncHandler(async (req, res) => {
    const { walletAddress, companyName, identityHash } = req.body ?? {};

    if (!walletAddress || typeof walletAddress !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "walletAddress is required");
    }
    if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
      return apiError(res, 400, "MISSING_FIELD", "companyName is required");
    }
    if (!identityHash || typeof identityHash !== "string" || !/^[0-9a-f]{64}$/i.test(identityHash)) {
      return apiError(res, 400, "INVALID_FIELD", "identityHash must be a 64-char hex SHA-256 string");
    }

    const row = await repo.upsertRegistration({
      walletAddress: walletAddress.trim(),
      companyName:   companyName.trim(),
      identityHash:  identityHash.toLowerCase(),
    });

    res.status(201).json(toApiFarmer(row));
  }));

  // ── GET /farmers/status/:address ───────────────────────────────────────────
  router.get("/status/:address", asyncHandler(async (req, res) => {
    const row = await repo.findByAddress(req.params["address"] as string);
    if (!row) {
      return apiError(res, 404, "NOT_FOUND", "No registration found for this address");
    }
    res.json(toApiFarmer(row));
  }));

  return router;
}

export function createCropsRouter(pool: Pool): Router {
  const router = Router();
  const repo   = new FarmerRepo(pool);

  // ── POST /crops/build-mint-tx ──────────────────────────────────────────────
  // Returns unsigned L1 tx CBOR for the farmer to sign in their browser wallet.
  router.post("/build-mint-tx", asyncHandler(async (req, res) => {
    const { farmerAddress, cropName, assetNameHex, quantity, priceLovelace } = req.body ?? {};

    if (!farmerAddress || typeof farmerAddress !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "farmerAddress is required");
    }
    if (!cropName || typeof cropName !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "cropName is required");
    }
    if (!assetNameHex || typeof assetNameHex !== "string" || !/^[0-9a-f]+$/i.test(assetNameHex)) {
      return apiError(res, 400, "INVALID_FIELD", "assetNameHex must be a hex string");
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return apiError(res, 400, "INVALID_FIELD", "quantity must be a positive integer");
    }
    const price = Number(priceLovelace);
    if (!Number.isInteger(price) || price < 2_000_000) {
      return apiError(res, 400, "INVALID_FIELD", "priceLovelace must be at least 2000000");
    }

    // Verify farmer is approved and has a FarmerPass tx on L1
    const farmer = await repo.findByAddress(farmerAddress);
    if (!farmer) return apiError(res, 404, "NOT_FOUND", "Farmer not registered");
    if (farmer.status !== "approved") return apiError(res, 403, "NOT_APPROVED", "FarmerPass required");
    if (!farmer.farmer_pass_tx_hash) return apiError(res, 409, "NO_FARMER_PASS", "FarmerPass not yet minted on L1");

    // Create pending DB record first so we have an ID
    const mintRecord = await repo.createCropMint({
      farmerAddress,
      cropName:      cropName.trim(),
      assetNameHex:  assetNameHex.toLowerCase(),
      quantity:      qty,
      priceLovelace: price,
    });

    // Derive farmer PKH
    const farmerPkh = getPaymentKeyHash(config.cardanoCliPath, farmerAddress);

    // FarmerPass UTxO is output #0 of the minting tx
    const farmerPassUtxoRef = `${farmer.farmer_pass_tx_hash}#0`;

    // Build unsigned L1 minting tx
    const { cborHex, txId } = buildCropMintTxUnsigned({
      farmerAddress,
      farmerPkh,
      farmerPassUtxoRef,
      assetNameHex:  assetNameHex.toLowerCase(),
      quantity:      qty,
    });

    res.status(201).json({
      mintId:      mintRecord.id,
      unsignedTxCbor: cborHex,
      txId,
      policyId:    getL1Scripts().cropTokenPolicyId,
    });
  }));

  // ── POST /crops/submit-mint-tx ─────────────────────────────────────────────
  // Receives signed CBOR from frontend, submits to L1, updates DB record.
  router.post("/submit-mint-tx", asyncHandler(async (req, res) => {
    const { mintId, signedTxCbor } = req.body ?? {};
    if (!mintId || typeof mintId !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "mintId is required");
    }
    if (!signedTxCbor || typeof signedTxCbor !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "signedTxCbor is required");
    }

    const txHash = submitL1Tx(signedTxCbor);
    const updated = await repo.confirmCropMint(mintId, txHash);
    if (!updated) return apiError(res, 404, "NOT_FOUND", "Crop mint record not found");

    res.json({ ok: true, txHash, status: updated.status });
  }));

  // ── POST /crops/submit-commit-tx — submit signed Hydra commit tx to L1 ─────
  router.post("/submit-commit-tx", asyncHandler(async (req, res) => {
    const { signedTxCbor } = req.body ?? {};
    if (!signedTxCbor || typeof signedTxCbor !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "signedTxCbor is required");
    }
    const txHash = submitL1Tx(signedTxCbor);
    res.json({ ok: true, txHash });
  }));

  // ── GET /crops/wallet/:address — L1 CropTokens currently in wallet ─────────
  router.get("/wallet/:address", asyncHandler(async (req, res) => {
    const address = req.params["address"] as string;
    const { cropTokenPolicyId } = getL1Scripts();
    const utxos = queryL1Utxos(address);

    // Aggregate quantities per asset name across all UTxOs
    const totals: Record<string, bigint> = {};
    for (const utxo of utxos) {
      const policyTokens = utxo.value[cropTokenPolicyId] as Record<string, number> | undefined;
      if (!policyTokens) continue;
      for (const [assetNameHex, qty] of Object.entries(policyTokens)) {
        totals[assetNameHex] = (totals[assetNameHex] ?? 0n) + BigInt(qty);
      }
    }

    const assets = Object.entries(totals).map(([assetNameHex, quantity]) => ({
      policyId:     cropTokenPolicyId,
      assetNameHex,
      assetName:    Buffer.from(assetNameHex, "hex").toString("utf8"),
      quantity:     Number(quantity),
    }));

    res.json(assets);
  }));

  // ── POST /crops/build-commit-tx — build combined classic Hydra commit tx ───
  // Body: { address, assetNameHex }
  // Commits pepito's CropToken UTxO + the operator's largest pure-ADA L1 UTxO
  // in a single classic commit (Head must be in Initializing state).
  // The operator's portion is signed server-side; returns partially-signed CBOR
  // for the farmer to add their witness in the browser wallet (partialSign=true).
  router.post("/build-commit-tx", asyncHandler(async (req, res) => {
    const { address, assetNameHex } = req.body ?? {};
    if (!address || typeof address !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "address is required");
    }
    if (!assetNameHex || typeof assetNameHex !== "string") {
      return apiError(res, 400, "MISSING_FIELD", "assetNameHex is required");
    }

    const { cropTokenPolicyId } = getL1Scripts();

    // ── 1. Find farmer's CropToken UTxO on L1 ─────────────────────────────
    const fullUtxos = queryL1UtxosFull(address) as Record<string, {
      value: Record<string, unknown>;
      address: string;
      datum: unknown;
      datumhash: unknown;
      inlineDatum: unknown;
      inlineDatumRaw: unknown;
      referenceScript: unknown;
    }>;

    const tokenEntry = Object.entries(fullUtxos).find(([, u]) => {
      const tokens = u.value[cropTokenPolicyId] as Record<string, number> | undefined;
      return tokens?.[assetNameHex] !== undefined;
    });
    if (!tokenEntry) {
      return apiError(res, 404, "TOKEN_NOT_FOUND",
        "CropToken not found in wallet UTxOs. May have already been committed to the Head.");
    }
    const [tokenUtxoRef, tokenUtxoData] = tokenEntry;

    // ── 2. Find operator's pure-ADA UTxOs on L1 ──────────────────────────
    // Sort by value descending; we'll try each until Hydra accepts one.
    // NOTE: Hydra cannot commit a UTxO whose txHash matches the head state
    // UTxO (both created in the Init tx). We detect this by retrying on
    // NotEnoughFuel responses.
    if (!config.operatorAddress) {
      return apiError(res, 503, "NO_OPERATOR_ADDRESS", "OPERATOR_ADDRESS not configured");
    }
    const operatorL1Utxos = queryL1UtxosFull(config.operatorAddress) as Record<string, {
      value: Record<string, unknown>;
      address: string;
      datum: unknown;
      datumhash: unknown;
      inlineDatum: unknown;
      inlineDatumRaw: unknown;
      referenceScript: unknown;
    }>;

    const operatorCandidates = Object.entries(operatorL1Utxos)
      .filter(([, u]) => {
        const keys = Object.keys(u.value).filter(k => k !== "lovelace");
        return keys.length === 0;
      })
      .sort((a, b) =>
        Number(BigInt(b[1].value.lovelace as number ?? 0) - BigInt(a[1].value.lovelace as number ?? 0))
      );

    if (operatorCandidates.length === 0) {
      return apiError(res, 503, "NO_OPERATOR_UTXO",
        "No pure-ADA UTxO found at operator address on L1");
    }

    // ── 3. Build combined Hydra commit body ───────────────────────────────
    const toCommitEntry = (ref: string, u: typeof tokenUtxoData) => ({
      address:         u.address,
      datum:           u.datum ?? null,
      datumhash:       u.datumhash ?? null,
      inlineDatum:     u.inlineDatum ?? null,
      inlineDatumRaw:  u.inlineDatumRaw ?? null,
      referenceScript: u.referenceScript ?? null,
      value:           u.value,
    });

    // ── 4. Try each operator UTxO until Hydra accepts (no NotEnoughFuel) ──
    let hydraData: { cborHex: string; txId: string; type: string } | null = null;
    let operatorUtxoRef = "";
    let operatorUtxoData = operatorCandidates[0][1];

    for (const [candidateRef, candidateData] of operatorCandidates) {
      const commitBody: Record<string, unknown> = {
        [tokenUtxoRef]:   toCommitEntry(tokenUtxoRef, tokenUtxoData),
        [candidateRef]:   toCommitEntry(candidateRef, candidateData),
      };
      const hydraRes = await fetch(`${config.hydraHttpUrl}/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(commitBody),
      });
      const text = await hydraRes.text();
      if (!hydraRes.ok || text.startsWith("NotEnoughFuel")) {
        // This UTxO conflicts with the head state input — try next
        continue;
      }
      hydraData = JSON.parse(text) as { cborHex: string; txId: string; type: string };
      operatorUtxoRef  = candidateRef;
      operatorUtxoData = candidateData;
      break;
    }

    if (!hydraData) {
      return apiError(res, 502, "HYDRA_ERROR",
        "All operator UTxOs caused NotEnoughFuel — Head may need re-init");
    }

    // ── 5. Operator signs the tx server-side ──────────────────────────────
    // This adds the operator's witness for their ADA UTxO.
    // The farmer will add their witness in the browser via partialSign=true.
    const dir = mkdtempSync(join(tmpdir(), "commit-"));
    let operatorSignedCbor: string;
    try {
      const unsignedFile = join(dir, "tx.unsigned.json");
      const signedFile   = join(dir, "tx.signed.json");
      writeFileSync(unsignedFile, JSON.stringify({
        type:        hydraData.type ?? "Tx ConwayEra",
        description: "",
        cborHex:     hydraData.cborHex,
      }));
      execSync(
        `${config.cardanoCliPath} latest transaction sign` +
        ` --tx-file ${unsignedFile}` +
        ` --signing-key-file ${config.skeyPath}` +
        ` --testnet-magic ${config.testnetMagic}` +
        ` --out-file ${signedFile}`
      );
      const signedTx = JSON.parse(readFileSync(signedFile, "utf8")) as { cborHex: string };
      operatorSignedCbor = signedTx.cborHex;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    res.json({
      tokenUtxoRef,
      operatorUtxoRef,
      // Partially signed by operator — farmer must sign with partialSign=true
      unsignedTxCbor: operatorSignedCbor,
      txId:           hydraData.txId,
    });
  }));

  // ── GET /crops/:address ────────────────────────────────────────────────────
  router.get("/:address", asyncHandler(async (req, res) => {
    const rows = await repo.listCropMints(req.params["address"] as string);
    res.json(rows.map(toApiCropMint));
  }));

  return router;
}
