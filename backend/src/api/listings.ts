// T5.1 — POST /api/listings
// T5.2 — GET  /api/listings
// T5.3 — GET  /api/listings/:id
// T5.4 — POST /api/listings/:id/escrow-confirm
// T6.1 — POST /api/listings/:id/buy

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { asyncHandler, apiError } from "./middleware";
import { ListingRepo } from "../db/listingRepo";
import { SaleRepo } from "../db/saleRepo";
import { CardanoCliBuilder } from "../tx";
import { getPaymentKeyHash } from "../utils/address";
import { config } from "../config";
import type { HydraClient } from "../hydra/client";
import type { Pool } from "pg";

const MIN_PRICE_LOVELACE = 2_000_000n;
const MIN_ADA_AT_SCRIPT  = 2_000_000n;

function toApiListing(row: import("../db/listingRepo").ListingRow) {
  return {
    id:             row.id,
    sellerAddress:  row.seller_address,
    policyId:       row.policy_id,
    assetName:      row.asset_name,
    unit:           row.unit,
    priceLovelace:  row.price_lovelace,
    status:         row.status,
    escrowTxHash:   row.escrow_tx_hash,
    escrowUtxoIx:   row.escrow_utxo_ix,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

export function createListingsRouter(pool: Pool, hydra: HydraClient): Router {
  const router   = Router();
  const repo     = new ListingRepo(pool);
  const saleRepo = new SaleRepo(pool);
  const builder = new CardanoCliBuilder({
    cardanoCliPath: config.cardanoCliPath,
    skeyPath:       config.skeyPath,
    testnetMagic:   config.testnetMagic,
  });

  // ── GET /listings ────────────────────────────────────────────────────────

  router.get("/", asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const seller = typeof req.query.seller === "string" ? req.query.seller : undefined;
    const limit  = Math.min(Number(req.query.limit  ?? 50), 100);
    const offset = Number(req.query.offset ?? 0);

    const { rows, total } = await repo.list({ status, seller, limit, offset });
    res.json({ listings: rows.map(toApiListing), total, limit, offset });
  }));

  // ── GET /listings/:id ────────────────────────────────────────────────────

  router.get("/:id", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");

    // Fetch sale if any
    const saleRes = await pool.query(
      `SELECT * FROM sales WHERE listing_id = $1 AND status = 'confirmed' LIMIT 1`,
      [listing.id]
    );
    const sale = saleRes.rows[0] ?? null;

    res.json({
      ...toApiListing(listing),
      sale: sale ? {
        id:           sale.id,
        buyerAddress: sale.buyer_address,
        hydraTxId:    sale.hydra_tx_id,
        status:       sale.status,
        confirmedAt:  sale.confirmed_at,
      } : null,
    });
  }));

  // ── POST /listings ────────────────────────────────────────────────────────

  router.post("/", asyncHandler(async (req, res) => {
    const { requestId, sellerAddress, policyId, assetName, priceLovelace: priceRaw } = req.body as {
      requestId:     string;
      sellerAddress: string;
      policyId:      string;
      assetName:     string;
      priceLovelace: string;
    };

    // Input validation
    if (!requestId || !sellerAddress || !policyId || !priceRaw) {
      return void apiError(res, 400, "invalid_request", "Missing required fields");
    }
    const priceLovelace = BigInt(priceRaw);
    if (priceLovelace < MIN_PRICE_LOVELACE) {
      return void apiError(res, 400, "invalid_request", "priceLovelace must be >= 2000000");
    }

    // Head must be open
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open", {
        headStatus: hydra.getHeadStatus(),
      });
    }

    // No duplicate active listing for this unit
    const unit = policyId + assetName;
    const existing = await repo.findByUnit(unit);
    if (existing && (existing.status === "active" || existing.status === "draft")) {
      return void apiError(res, 409, "already_listed", "NFT already has an active listing", {
        existingListingId: existing.id,
      });
    }

    // Script address must be configured
    if (!config.scriptAddress) {
      return void apiError(res, 503, "script_not_configured",
        "Listing validator not configured (set SCRIPT_ADDRESS env var after Epic 8)");
    }

    // Find NFT UTxO in current Head snapshot
    const utxos = hydra.getUtxos();
    const nftRef = Object.entries(utxos).find(([, u]) => {
      const assets = u.value[policyId] as Record<string, number> | undefined;
      return u.address === sellerAddress && assets?.[assetName] === 1;
    });
    if (!nftRef) {
      return void apiError(res, 400, "nft_not_in_head",
        "NFT not found in seller's Head UTxOs. Commit the NFT UTxO into the Head first.");
    }
    const [inputRef, inputUtxo] = nftRef;
    const inputLovelace = BigInt(inputUtxo.value.lovelace ?? 0);

    // Get seller VKH from address
    const sellerVkh = getPaymentKeyHash(config.cardanoCliPath, sellerAddress);

    // Get or create head session id from DB
    const sessionRes = await pool.query(
      `SELECT id FROM head_sessions WHERE status = 'open' LIMIT 1`
    );
    if (!sessionRes.rows[0]) {
      return void apiError(res, 503, "head_not_open", "No open head session in DB");
    }
    const headSessionId = sessionRes.rows[0].id as string;

    // Create listing record (draft)
    const listing = await repo.create({
      sellerAddress,
      policyId,
      assetName,
      priceLovelace,
      headSessionId,
    });

    // Build unsigned escrow tx (seller will sign it)
    const tx = builder.buildEscrowTxUnsigned({
      inputRef,
      inputLovelace,
      inputUnit:     unit,
      sellerAddress,
      sellerVkh,
      scriptAddress: config.scriptAddress,
      priceLovelace,
      minLovelace:   MIN_ADA_AT_SCRIPT,
      fee:           config.txFee,
    });

    res.status(201).json({
      listingId:    listing.id,
      status:       "draft",
      escrowTxCbor: tx.cborHex,
      txId:         tx.txId,
      message:      "Sign escrowTxCbor with your wallet and POST it to /listings/:id/escrow-confirm",
    });
  }));

  // ── POST /listings/:id/escrow-confirm ─────────────────────────────────────
  // Body: { signedTxCbor: string, txId: string }
  // txId is returned by POST /listings — the client must echo it back

  router.post("/:id/escrow-confirm", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "draft") {
      return void apiError(res, 409, "invalid_status",
        `Listing is in status '${listing.status}', expected 'draft'`);
    }

    const { signedTxCbor, txId } = req.body as { signedTxCbor: string; txId: string };
    if (!signedTxCbor || !txId) {
      return void apiError(res, 400, "invalid_request", "Missing signedTxCbor or txId");
    }
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open");
    }

    // Record submission
    const submissionId = uuidv4();
    await pool.query(
      `INSERT INTO tx_submissions (id, request_id, listing_id, action, hydra_tx_id, status)
       VALUES ($1, $2, $3, 'list', $4, 'pending')`,
      [submissionId, submissionId, listing.id, txId]
    );

    // Submit to Hydra, then await TxValid/TxInvalid
    hydra.submitTx(signedTxCbor, "Tx ConwayEra");

    try {
      await hydra.awaitTxConfirmation(txId, 30_000);

      // Activate listing — find output index 0 (the script UTxO)
      await repo.setEscrow(listing.id, txId, 0);
      await pool.query(
        `UPDATE tx_submissions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [submissionId]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE tx_submissions SET status = 'failed', error_message = $1 WHERE id = $2`,
        [msg, submissionId]
      );
      return void apiError(res, 502, "hydra_submission_failed", msg);
    }

    res.json({ submissionId, status: "confirmed" });
  }));

  // ── POST /listings/:id/buy ─────────────────────────────────────────────────
  // T6.1 — Backend builds, signs (operator key), and submits the buy tx.
  // The escrow UTxO must hold: NFT + priceLovelace + minADA + fee (seller-funded model).

  router.post("/:id/buy", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "active") {
      return void apiError(res, 409, "listing_not_available",
        "Listing is not active", { status: listing.status });
    }

    const { requestId, buyerAddress } = req.body as {
      requestId:    string;
      buyerAddress: string;
    };
    if (!requestId || !buyerAddress) {
      return void apiError(res, 400, "invalid_request", "Missing requestId or buyerAddress");
    }

    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open", {
        headStatus: hydra.getHeadStatus(),
      });
    }

    // Idempotency — reject duplicate requestId
    const dupCheck = await pool.query(
      `SELECT id FROM tx_submissions WHERE request_id = $1`,
      [requestId]
    );
    if (dupCheck.rows.length > 0) {
      return void apiError(res, 409, "duplicate_request", "requestId already used");
    }

    // No concurrent pending sale
    const pending = await saleRepo.findPendingByListing(listing.id);
    if (pending) {
      return void apiError(res, 409, "listing_not_available", "Purchase already in progress");
    }

    if (!config.scriptCbor || !config.scriptAddress) {
      return void apiError(res, 503, "script_not_configured",
        "Listing validator not configured (set SCRIPT_CBOR + SCRIPT_ADDRESS after Epic 8)");
    }

    // Locate escrow UTxO in Head snapshot
    const escrowRef = `${listing.escrow_tx_hash}#${listing.escrow_utxo_ix}`;
    const utxos = hydra.getUtxos();
    const escrowUtxo = utxos[escrowRef];
    if (!escrowUtxo) {
      return void apiError(res, 400, "escrow_not_in_head",
        `Escrow UTxO ${escrowRef} not found in current Head snapshot`);
    }
    const escrowLovelace = BigInt(escrowUtxo.value.lovelace ?? 0);

    // Find a pure-ADA UTxO in the Head for collateral (operator-owned)
    const collateralEntry = Object.entries(utxos).find(([ref, u]) => {
      if (ref === escrowRef) return false;
      // Only lovelace, no other tokens
      const keys = Object.keys(u.value).filter(k => k !== "lovelace");
      return keys.length === 0 && (u.value.lovelace ?? 0) >= 5_000_000;
    });
    if (!collateralEntry) {
      return void apiError(res, 503, "no_collateral",
        "No suitable collateral UTxO found in Head (need pure-ADA UTxO >= 5 ADA)");
    }
    const [collateralRef] = collateralEntry;

    // Build buyer VKH for redeemer
    const buyerVkh  = getPaymentKeyHash(config.cardanoCliPath, buyerAddress);
    const redeemer  = JSON.stringify({
      constructor: 0,
      fields: [{ bytes: buyerVkh }],
    });

    // Build and sign buy tx (operator signs — no buyer sig required for Buy action)
    const tx = builder.buildBuyTx({
      escrowRef,
      escrowLovelace,
      collateralRef,
      sellerAddress:  listing.seller_address,
      priceLovelace:  BigInt(listing.price_lovelace),
      buyerAddress,
      unit:           listing.unit,
      minLovelace:    MIN_ADA_AT_SCRIPT,
      scriptCbor:     config.scriptCbor,
      redeemerCbor:   redeemer,
      fee:            config.txFee,
    });

    // Create sale record + submission
    const sale = await saleRepo.create({
      listingId:     listing.id,
      buyerAddress,
      sellerAddress: listing.seller_address,
      unit:          listing.unit,
      priceLovelace: BigInt(listing.price_lovelace),
    });

    const submissionId = uuidv4();
    await pool.query(
      `INSERT INTO tx_submissions (id, request_id, listing_id, action, hydra_tx_id, status)
       VALUES ($1, $2, $3, 'buy', $4, 'pending')`,
      [submissionId, requestId, listing.id, tx.txId]
    );

    // Submit to Hydra and await confirmation
    hydra.submitTx(tx.cborHex, tx.type);

    try {
      await hydra.awaitTxConfirmation(tx.txId, 30_000);

      // Confirm sale + mark listing sold
      await saleRepo.confirm(sale.id, tx.txId);
      await repo.setStatus(listing.id, "sold");
      await pool.query(
        `UPDATE tx_submissions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [submissionId]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await saleRepo.fail(sale.id);
      await pool.query(
        `UPDATE tx_submissions SET status = 'failed', error_message = $1 WHERE id = $2`,
        [msg, submissionId]
      );
      return void apiError(res, 502, "hydra_submission_failed", msg);
    }

    res.status(202).json({
      saleId:       sale.id,
      submissionId,
      hydraTxId:    tx.txId,
      status:       "confirmed",
      message:      "Purchase confirmed inside Hydra Head",
    });
  }));

  // ── GET /listings/:id/cancel-tx ────────────────────────────────────────────
  // T7.1 — Build and return unsigned cancel tx for seller to sign.

  router.get("/:id/cancel-tx", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "active") {
      return void apiError(res, 409, "listing_not_available",
        `Cannot cancel listing with status '${listing.status}'`);
    }
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open");
    }
    if (!config.scriptCbor || !config.scriptAddress) {
      return void apiError(res, 503, "script_not_configured",
        "Listing validator not configured (set SCRIPT_CBOR + SCRIPT_ADDRESS after Epic 8)");
    }

    const escrowRef = `${listing.escrow_tx_hash}#${listing.escrow_utxo_ix}`;
    const utxos = hydra.getUtxos();
    const escrowUtxo = utxos[escrowRef];
    if (!escrowUtxo) {
      return void apiError(res, 400, "escrow_not_in_head",
        `Escrow UTxO ${escrowRef} not found in current Head snapshot`);
    }
    const escrowLovelace = BigInt(escrowUtxo.value.lovelace ?? 0);

    // Collateral: any pure-ADA UTxO in the Head
    const collateralEntry = Object.entries(utxos).find(([ref, u]) => {
      if (ref === escrowRef) return false;
      const keys = Object.keys(u.value).filter(k => k !== "lovelace");
      return keys.length === 0 && (u.value.lovelace ?? 0) >= 5_000_000;
    });
    if (!collateralEntry) {
      return void apiError(res, 503, "no_collateral",
        "No suitable collateral UTxO found in Head (need pure-ADA UTxO >= 5 ADA)");
    }
    const [collateralRef] = collateralEntry;

    const sellerVkh = getPaymentKeyHash(config.cardanoCliPath, listing.seller_address);

    const tx = builder.buildCancelTxUnsigned({
      escrowRef,
      escrowLovelace,
      collateralRef,
      sellerAddress: listing.seller_address,
      sellerVkh,
      unit:          listing.unit,
      scriptCbor:    config.scriptCbor,
      fee:           config.txFee,
    });

    res.json({ unsignedTxCbor: tx.cborHex, txId: tx.txId });
  }));

  // ── POST /listings/:id/cancel ──────────────────────────────────────────────
  // T7.2 — Seller posts signed cancel tx CBOR; backend submits to Hydra.

  router.post("/:id/cancel", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "active") {
      return void apiError(res, 409, "listing_not_available",
        `Cannot cancel listing with status '${listing.status}'`);
    }

    const { requestId, sellerAddress, signedCancelTxCbor, txId } = req.body as {
      requestId:           string;
      sellerAddress:       string;
      signedCancelTxCbor:  string;
      txId:                string;
    };
    if (!requestId || !sellerAddress || !signedCancelTxCbor || !txId) {
      return void apiError(res, 400, "invalid_request",
        "Missing requestId, sellerAddress, signedCancelTxCbor, or txId");
    }

    // Authorisation: caller must be the seller
    if (sellerAddress !== listing.seller_address) {
      return void apiError(res, 403, "unauthorized", "sellerAddress does not match listing");
    }
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open");
    }

    // Idempotency
    const dup = await pool.query(
      `SELECT id FROM tx_submissions WHERE request_id = $1`, [requestId]
    );
    if (dup.rows.length > 0) {
      return void apiError(res, 409, "duplicate_request", "requestId already used");
    }

    const submissionId = uuidv4();
    await pool.query(
      `INSERT INTO tx_submissions (id, request_id, listing_id, action, hydra_tx_id, status)
       VALUES ($1, $2, $3, 'cancel', $4, 'pending')`,
      [submissionId, requestId, listing.id, txId]
    );

    hydra.submitTx(signedCancelTxCbor, "Tx ConwayEra");

    try {
      await hydra.awaitTxConfirmation(txId, 30_000);
      await repo.setStatus(listing.id, "cancelled");
      await pool.query(
        `UPDATE tx_submissions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [submissionId]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE tx_submissions SET status = 'failed', error_message = $1 WHERE id = $2`,
        [msg, submissionId]
      );
      return void apiError(res, 502, "hydra_submission_failed", msg);
    }

    res.status(202).json({ submissionId, status: "confirmed" });
  }));

  return router;
}
