// GET  /api/head/status   — returns current head session state
// POST /api/head/init     — send Init command to Hydra node
// POST /api/head/collect  — send Collect command to open Head after all commits
// POST /api/head/split-ada — split operator's largest pure-ADA UTxO inside Head
// POST /api/head/submit-raw — submit a pre-signed tx CBOR directly to Hydra

import { Router } from "express";
import { asyncHandler, apiError } from "./middleware";
import { CardanoCliBuilder } from "../tx";
import { config } from "../config";
import type { Pool } from "pg";
import type { HydraClient } from "../hydra/client";

export function createHeadRouter(pool: Pool, hydra: HydraClient): Router {
  const router = Router();

  // GET /api/head/utxos — current Head snapshot UTxO set (fresh from Hydra node)
  router.get("/utxos", asyncHandler(async (_req, res) => {
    const utxos = await hydra.fetchUtxos();
    res.json(utxos);
  }));

  router.get("/status", asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM head_sessions ORDER BY created_at DESC LIMIT 1`
    );
    const session = rows[0] ?? null;

    res.json({
      sessionId:               session?.id ?? null,
      status:                  session?.status ?? hydra.getHeadStatus(),
      network:                 session?.network ?? "preprod",
      contestationPeriodSecs:  session?.contestation_period_secs ?? 600,
      openedAt:                session?.opened_at ?? null,
      closedAt:                session?.closed_at ?? null,
      contestationDeadline:    session?.contestation_deadline ?? null,
    });
  }));

  // POST /api/head/init — send Init command (Head must be Idle)
  router.post("/init", asyncHandler(async (_req, res) => {
    const status = hydra.getHeadStatus();
    if (status !== "Idle") {
      return void apiError(res, 409, "head_not_idle", `Head is '${status}', not Idle`);
    }
    hydra.initHead();
    res.json({ ok: true, message: "Init command sent" });
  }));

  // POST /api/head/collect — send Collect command (Head must be Initializing)
  // Waits for HeadIsOpen and records the session in DB.
  // Note: in Hydra v1.2.0 the WS "Collect" command is rejected (APIInvalidInput)
  // but CollectCom fires automatically after all classic commit txs are confirmed on L1.
  // awaitHeadOpen catches the HeadIsOpen event however it arrives.
  router.post("/collect", asyncHandler(async (_req, res) => {
    const status = hydra.getHeadStatus();
    if (status !== "Initializing") {
      return void apiError(res, 409, "head_not_initializing",
        `Head is '${status}', expected 'Initializing'`);
    }
    hydra.collect();

    // Wait for HeadIsOpen (up to 60s) and record session in DB
    try {
      await hydra.awaitHeadOpen(60_000);
      await pool.query(
        `INSERT INTO head_sessions (id, status, network, contestation_period_secs, opened_at)
         VALUES (gen_random_uuid(), 'open', 'preprod', 600, now())
         ON CONFLICT DO NOTHING`
      );
    } catch {
      // Head may still open later; non-fatal — caller can poll /status
    }

    res.json({ ok: true, message: "Collect command sent", headStatus: hydra.getHeadStatus() });
  }));

  // POST /api/head/split-ada — intra-Head ADA split so we have ≥2 pure-ADA UTxOs
  // (needed for collateral + buyer-input in buy transactions)
  // Body: { splitLovelace?: number }  default: 20_000_000 (20 ADA)
  router.post("/split-ada", asyncHandler(async (req, res) => {
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Head is not open");
    }
    if (!config.operatorAddress) {
      return void apiError(res, 503, "no_operator_address", "OPERATOR_ADDRESS not configured");
    }

    const splitLovelace = BigInt((req.body as { splitLovelace?: number })?.splitLovelace ?? 20_000_000);
    const utxos = hydra.getUtxos();

    // Find largest pure-ADA UTxO at operator address
    const pureAdaEntries = Object.entries(utxos)
      .filter(([, u]) => {
        const keys = Object.keys(u.value).filter(k => k !== "lovelace");
        return keys.length === 0 && u.address === config.operatorAddress;
      })
      .sort((a, b) => Number(BigInt(b[1].value.lovelace ?? 0) - BigInt(a[1].value.lovelace ?? 0)));

    if (pureAdaEntries.length === 0) {
      return void apiError(res, 400, "no_utxo", "No pure-ADA UTxO found at operator address in Head");
    }

    const [inputRef, inputUtxo] = pureAdaEntries[0];
    const inputLovelace = BigInt(inputUtxo.value.lovelace ?? 0);
    if (inputLovelace <= splitLovelace + 2_000_000n) {
      return void apiError(res, 400, "insufficient_funds",
        `UTxO has ${inputLovelace} lovelace, not enough to split off ${splitLovelace}`);
    }

    const builder = new CardanoCliBuilder({
      cardanoCliPath: config.cardanoCliPath,
      skeyPath:       config.skeyPath,
      testnetMagic:   config.testnetMagic,
    });

    const tx = builder.buildAdaTransfer({
      inputRef,
      inputLovelace,
      toAddress:     config.operatorAddress,
      sendLovelace:  splitLovelace,
      changeAddress: config.operatorAddress,
      fee:           config.txFee,
    });

    hydra.submitTx(tx.cborHex, tx.type);

    try {
      await hydra.awaitTxConfirmation(tx.txId, 30_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return void apiError(res, 502, "hydra_tx_failed", msg);
    }

    res.json({ ok: true, txId: tx.txId, splitLovelace: splitLovelace.toString() });
  }));

  // POST /api/head/submit-raw — accept a fully-signed tx CBOR and submit to Hydra
  // Body: { signedTxCbor: string, txId: string }
  router.post("/submit-raw", asyncHandler(async (req, res) => {
    const { signedTxCbor, txId } = req.body as { signedTxCbor?: string; txId?: string };
    if (!signedTxCbor || !txId) {
      return void apiError(res, 400, "invalid_request", "Missing signedTxCbor or txId");
    }
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open");
    }
    hydra.submitTx(signedTxCbor, "Tx ConwayEra");
    try {
      await hydra.awaitTxConfirmation(txId, 30_000);
      res.json({ ok: true, status: "confirmed", txId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return void apiError(res, 502, "hydra_tx_failed", msg);
    }
  }));

  return router;
}
