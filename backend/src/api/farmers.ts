// POST /api/farmers/register      — submit KYC (identity_hash computed in browser)
// GET  /api/farmers/status/:addr  — check own registration status
// POST /api/crops/mint            — record a crop mint intent (after tx confirmed on L2)
// GET  /api/crops/:addr           — list crop mints for a farmer

import { Router } from "express";
import { asyncHandler, apiError } from "./middleware";
import { FarmerRepo } from "../db/farmerRepo";
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

  // ── POST /crops/mint ───────────────────────────────────────────────────────
  router.post("/mint", asyncHandler(async (req, res) => {
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

    // Verify farmer is approved
    const farmer = await repo.findByAddress(farmerAddress);
    if (!farmer) {
      return apiError(res, 404, "NOT_FOUND", "Farmer not registered");
    }
    if (farmer.status !== "approved") {
      return apiError(res, 403, "NOT_APPROVED", "Farmer must be approved before minting crops");
    }

    const row = await repo.createCropMint({
      farmerAddress,
      cropName:     cropName.trim(),
      assetNameHex: assetNameHex.toLowerCase(),
      quantity:     qty,
      priceLovelace: price,
    });

    res.status(201).json(toApiCropMint(row));
  }));

  // ── GET /crops/:address ────────────────────────────────────────────────────
  router.get("/:address", asyncHandler(async (req, res) => {
    const rows = await repo.listCropMints(req.params["address"] as string);
    res.json(rows.map(toApiCropMint));
  }));

  return router;
}
