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

function hexToUtf8(hex: string): string | null {
  try {
    const buf = Buffer.from(hex, "hex");
    const str = buf.toString("utf8");
    // Reject if it looks like raw binary (non-printable chars)
    if (/[\x00-\x08\x0e-\x1f\x7f]/.test(str)) return null;
    return str || null;
  } catch {
    return null;
  }
}

function toApiListing(row: import("../db/listingRepo").ListingRow) {
  return {
    id:             row.id,
    sellerAddress:  row.seller_address,
    policyId:       row.policy_id,
    assetName:      row.asset_name,
    unit:           row.unit,
    displayName:    hexToUtf8(row.asset_name),
    imageUrl:       null as null,
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

  // ── GET /listings/my-escrows/:address ───────────────────────────────────
  // Returns all active listings owned by the given seller address,
  // with a flag indicating whether the escrow UTxO is still present in the Head.

  router.get("/my-escrows/:address", asyncHandler(async (req, res) => {
    const { address } = req.params as { address: string };
    const { rows } = await repo.list({ status: "active", seller: address, limit: 50, offset: 0 });

    const headUtxos = hydra.isOpen() ? hydra.getUtxos() : {};

    const result = rows.map((row) => {
      const escrowRef = row.escrow_tx_hash
        ? `${row.escrow_tx_hash}#${row.escrow_utxo_ix ?? 0}`
        : null;
      const inHead = escrowRef ? Boolean(headUtxos[escrowRef]) : false;
      return {
        ...toApiListing(row),
        escrowRef,
        inHead,
      };
    });

    res.json({ escrows: result });
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

    // No duplicate active listing for this unit; stale drafts are silently replaced
    const unit = policyId + assetName;
    const existing = await repo.findByUnit(unit);
    if (existing) {
      if (existing.status === "active") {
        return void apiError(res, 409, "already_listed", "NFT already has an active listing", {
          existingListingId: existing.id,
        });
      }
      // Draft exists — delete it so we can create a fresh one
      if (existing.status === "draft") {
        await pool.query(`DELETE FROM tx_submissions WHERE listing_id = $1`, [existing.id]);
        await pool.query(`DELETE FROM listings WHERE id = $1`, [existing.id]);
      }
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
      return u.address === sellerAddress && (assets?.[assetName] ?? 0) >= 1;
    });
    if (!nftRef) {
      return void apiError(res, 400, "nft_not_in_head",
        "NFT not found in seller's Head UTxOs. Commit the NFT UTxO into the Head first.");
    }
    const [inputRef, inputUtxo] = nftRef;
    const inputLovelace = BigInt(inputUtxo.value.lovelace ?? 0);
    const tokenQuantity = BigInt(
      (inputUtxo.value[policyId] as Record<string, number> | undefined)?.[assetName] ?? 1
    );

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

    // If seller UTxO has no spare ADA for fees, use operator's ADA as fee input
    const sellerSpare = inputLovelace - MIN_ADA_AT_SCRIPT;
    let feeInputRef: string | undefined;
    let feeInputLovelace: bigint | undefined;
    if (sellerSpare < config.txFee && config.operatorAddress) {
      const opUtxo = Object.entries(utxos).find(([, u]) => {
        const keys = Object.keys(u.value).filter(k => k !== "lovelace");
        return keys.length === 0 && u.address === config.operatorAddress;
      });
      if (opUtxo) {
        feeInputRef      = opUtxo[0];
        feeInputLovelace = BigInt(opUtxo[1].value.lovelace ?? 0);
      }
    }

    // Build unsigned escrow tx (seller will sign; operator pre-signs if fee input used)
    const tx = builder.buildEscrowTxUnsigned({
      inputRef,
      inputLovelace,
      inputUnit:        unit,
      inputQuantity:    tokenQuantity,
      sellerAddress,
      sellerVkh,
      scriptAddress:    config.scriptAddress,
      priceLovelace,
      minLovelace:      MIN_ADA_AT_SCRIPT,
      fee:              config.txFee,
      feeInputRef,
      feeInputLovelace,
      feeChangeAddress: config.operatorAddress,
    });

    // If operator fee input used, pre-sign with operator key so seller only needs partialSign
    let escrowTxCbor = tx.cborHex;
    if (feeInputRef) {
      escrowTxCbor = builder.signTx(tx.cborHex, tx.type);
    }

    res.status(201).json({
      listingId:    listing.id,
      status:       "draft",
      escrowTxCbor,
      txId:         tx.txId,
      needsPartialSign: !!feeInputRef,
      message:      "Sign escrowTxCbor with your wallet and POST it to /listings/:id/escrow-confirm",
    });
  }));

  // ── POST /listings/:id/rebuild-escrow ─────────────────────────────────────
  // Regenerates the unsigned escrow CBOR for a draft listing (e.g. after page refresh).
  router.post("/:id/rebuild-escrow", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "draft") {
      return void apiError(res, 409, "invalid_status",
        `Listing is '${listing.status}', not a draft`);
    }
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open");
    }

    const { policy_id: policyId, asset_name: assetName, seller_address: sellerAddress, price_lovelace } = listing;
    const unit = policyId + assetName;
    const priceLovelace = BigInt(price_lovelace);

    const utxos = hydra.getUtxos();
    const nftRef = Object.entries(utxos).find(([, u]) => {
      const assets = u.value[policyId] as Record<string, number> | undefined;
      return u.address === sellerAddress && (assets?.[assetName] ?? 0) >= 1;
    });
    if (!nftRef) {
      return void apiError(res, 400, "nft_not_in_head",
        "NFT not found in Head — may have already been escrowed or moved");
    }
    const [inputRef, inputUtxo] = nftRef;
    const inputLovelace = BigInt(inputUtxo.value.lovelace ?? 0);
    const tokenQuantity = BigInt(
      (inputUtxo.value[policyId] as Record<string, number> | undefined)?.[assetName] ?? 1
    );
    const sellerVkh = getPaymentKeyHash(config.cardanoCliPath, sellerAddress);

    const tx = builder.buildEscrowTxUnsigned({
      inputRef,
      inputLovelace,
      inputUnit:     unit,
      inputQuantity: tokenQuantity,
      sellerAddress,
      sellerVkh,
      scriptAddress: config.scriptAddress!,
      priceLovelace,
      minLovelace:   MIN_ADA_AT_SCRIPT,
      fee:           config.txFee,
    });

    res.json({ escrowTxCbor: tx.cborHex, txId: tx.txId });
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

    const pollSnapshotForEscrow = async (txId: string, pollMs: number): Promise<boolean> => {
      const deadline = Date.now() + pollMs;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        const snap = hydra.getUtxos();
        if (Object.keys(snap).some(ref => ref.startsWith(txId + "#"))) return true;
      }
      return false;
    };

    try {
      await hydra.awaitTxConfirmation(txId, 60_000);
    } catch (err) {
      const confirmedInSnapshot = await pollSnapshotForEscrow(txId, 15_000);
      if (!confirmedInSnapshot) {
        const msg = err instanceof Error ? err.message : String(err);
        await pool.query(
          `UPDATE tx_submissions SET status = 'failed', error_message = $1 WHERE id = $2`,
          [msg, submissionId]
        );
        return void apiError(res, 502, "hydra_submission_failed", msg);
      }
    }

    // Activate listing — find output index 0 (the script UTxO)
    await repo.setEscrow(listing.id, txId, 0);
    await pool.query(
      `UPDATE tx_submissions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
      [submissionId]
    );

    res.json({ submissionId, status: "confirmed" });
  }));

  // ── POST /listings/:id/buy ─────────────────────────────────────────────────
  // DEX model: buyer's own in-Head UTxO pays for the NFT.
  // Step 1 — backend builds unsigned tx, returns CBOR for buyer to sign.
  //
  // Body: { buyerAddress: string, buyerUtxoRef: string }
  // Response: { unsignedTxCbor, txId, message }

  router.post("/:id/buy", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "active") {
      return void apiError(res, 409, "listing_not_available",
        "Listing is not active", { status: listing.status });
    }

    const { buyerAddress, buyerUtxoRef } = req.body as {
      buyerAddress:  string;
      buyerUtxoRef?: string;   // optional — backend picks if omitted
    };
    if (!buyerAddress) {
      return void apiError(res, 400, "invalid_request", "Missing buyerAddress");
    }

    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open", {
        headStatus: hydra.getHeadStatus(),
      });
    }

    if (!config.scriptCbor || !config.scriptAddress) {
      return void apiError(res, 503, "script_not_configured",
        "Listing validator not configured (set SCRIPT_CBOR + SCRIPT_ADDRESS)");
    }

    // No concurrent pending sale
    const pending = await saleRepo.findPendingByListing(listing.id);
    if (pending) {
      return void apiError(res, 409, "listing_not_available", "Purchase already in progress");
    }

    // Locate escrow UTxO
    const escrowRef = `${listing.escrow_tx_hash}#${listing.escrow_utxo_ix}`;
    const utxos     = hydra.getUtxos();
    const escrowUtxo = utxos[escrowRef];
    if (!escrowUtxo) {
      return void apiError(res, 400, "escrow_not_in_head",
        `Escrow UTxO ${escrowRef} not found in Head snapshot`);
    }

    const escrowLovelace = BigInt(escrowUtxo.value.lovelace ?? 0);
    const policyId       = listing.unit.slice(0, 56);
    const assetName      = listing.unit.slice(56);
    const escrowTokenQty = BigInt(
      (escrowUtxo.value[policyId] as Record<string, number> | undefined)?.[assetName] ?? 1
    );
    const priceLovelace = BigInt(listing.price_lovelace);

    // Find buyer's in-Head UTxO (pure-ADA, owned by buyer)
    const isPureAda = (ref: string, u: { address: string; value: Record<string, unknown> }) =>
      ref !== escrowRef &&
      u.address === buyerAddress &&
      Object.keys(u.value).filter(k => k !== "lovelace").length === 0;

    let buyerInputRef: string;
    let buyerInputLovelace: bigint;

    if (buyerUtxoRef) {
      const u = utxos[buyerUtxoRef];
      if (!u) return void apiError(res, 400, "utxo_not_found", `UTxO ${buyerUtxoRef} not in Head`);
      buyerInputRef      = buyerUtxoRef;
      buyerInputLovelace = BigInt(u.value.lovelace ?? 0);
    } else {
      // Pick the largest pure-ADA UTxO at buyer's address
      const candidates = Object.entries(utxos)
        .filter(([ref, u]) => isPureAda(ref, u))
        .sort((a, b) => Number(BigInt(b[1].value.lovelace ?? 0) - BigInt(a[1].value.lovelace ?? 0)));

      if (candidates.length === 0) {
        return void apiError(res, 400, "no_buyer_utxo",
          `No pure-ADA UTxO found for buyer ${buyerAddress} in Head. ` +
          `Deposit ADA first via POST /api/wallet/deposit.`);
      }
      [buyerInputRef, ] = candidates[0];
      buyerInputLovelace = BigInt(candidates[0][1].value.lovelace ?? 0);
    }

    if (buyerInputLovelace < priceLovelace + MIN_ADA_AT_SCRIPT) {
      return void apiError(res, 400, "insufficient_buyer_funds",
        `Buyer UTxO has ${buyerInputLovelace} lovelace but needs at least ${priceLovelace + MIN_ADA_AT_SCRIPT}`);
    }

    // Operator's collateral UTxO (any pure-ADA UTxO at operator address)
    const collateralEntry = Object.entries(utxos).find(([ref, u]) => {
      if (ref === escrowRef || ref === buyerInputRef) return false;
      const keys = Object.keys(u.value).filter(k => k !== "lovelace");
      return keys.length === 0 &&
             u.address === config.operatorAddress &&
             BigInt(u.value.lovelace ?? 0) >= 5_000_000n;
    });
    if (!collateralEntry) {
      return void apiError(res, 503, "no_operator_collateral",
        "No operator collateral UTxO (>= 5 ADA, pure-ADA) in Head. Use POST /api/head/split-ada.");
    }
    const [collateralRef] = collateralEntry;
    const buyerVkh = getPaymentKeyHash(config.cardanoCliPath, buyerAddress);

    const tx = builder.buildBuyTxUnsigned({
      escrowRef,
      escrowLovelace,
      escrowTokenQty,
      buyerInputRef,
      buyerInputLovelace,
      buyerVkh,
      collateralRef,
      changeAddress:  buyerAddress,   // change goes back to buyer
      sellerAddress:  listing.seller_address,
      priceLovelace,
      buyerAddress,
      unit:           listing.unit,
      minLovelace:    MIN_ADA_AT_SCRIPT,
      scriptCbor:     config.scriptCbor,
      fee:            config.txFee,
    });

    res.json({
      unsignedTxCbor: tx.cborHex,
      txId:           tx.txId,
      buyerInputRef,
      collateralRef,
      message: "Sign unsignedTxCbor with your wallet (partialSign=true) and POST to /:id/buy-submit",
    });
  }));

  // ── POST /listings/:id/buy-submit ──────────────────────────────────────────
  // Step 2 — buyer submits their partially-signed tx; operator adds collateral
  // signature and submits to Hydra.
  //
  // Body: { requestId, buyerAddress, partiallySignedTxCbor, txId }

  router.post("/:id/buy-submit", asyncHandler(async (req, res) => {
    const listing = await repo.findById(req.params["id"] as string);
    if (!listing) return void apiError(res, 404, "listing_not_found", "No listing with that ID");
    if (listing.status !== "active") {
      return void apiError(res, 409, "listing_not_available",
        "Listing is not active", { status: listing.status });
    }

    const { requestId, buyerAddress, partiallySignedTxCbor, txId } = req.body as {
      requestId:             string;
      buyerAddress:          string;
      partiallySignedTxCbor: string;
      txId:                  string;
    };
    if (!requestId || !buyerAddress || !partiallySignedTxCbor || !txId) {
      return void apiError(res, 400, "invalid_request",
        "Missing requestId, buyerAddress, partiallySignedTxCbor, or txId");
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

    // No concurrent pending sale
    const pending = await saleRepo.findPendingByListing(listing.id);
    if (pending) {
      return void apiError(res, 409, "listing_not_available", "Purchase already in progress");
    }

    // Operator adds its signature (for collateral input)
    const fullSignedCbor = builder.signTx(partiallySignedTxCbor, "Tx ConwayEra");

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
      [submissionId, requestId, listing.id, txId]
    );

    hydra.submitTx(fullSignedCbor, "Tx ConwayEra");

    const pollSnapshotForTx = async (id: string, pollMs: number): Promise<boolean> => {
      const deadline = Date.now() + pollMs;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        const snap = hydra.getUtxos();
        if (Object.keys(snap).some(ref => ref.startsWith(id + "#"))) return true;
      }
      return false;
    };

    try {
      await hydra.awaitTxConfirmation(txId, 60_000);
    } catch (err) {
      const confirmedInSnapshot = await pollSnapshotForTx(txId, 15_000);
      if (!confirmedInSnapshot) {
        const msg = err instanceof Error ? err.message : String(err);
        await saleRepo.fail(sale.id);
        await pool.query(
          `UPDATE tx_submissions SET status = 'failed', error_message = $1 WHERE id = $2`,
          [msg, submissionId]
        );
        return void apiError(res, 502, "hydra_submission_failed", msg);
      }
    }

    await saleRepo.confirm(sale.id, txId);
    await repo.setStatus(listing.id, "sold");
    await pool.query(
      `UPDATE tx_submissions SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
      [submissionId]
    );

    res.status(202).json({
      saleId:    sale.id,
      submissionId,
      hydraTxId: txId,
      status:    "confirmed",
      message:   "Purchase confirmed inside Hydra Head",
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
