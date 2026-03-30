// Wallet endpoints — deposit / withdraw / balance
//
// GET  /api/wallet/balance/:address  — in-Head UTxOs for a given address
// POST /api/wallet/deposit           — build an incremental commit (deposit) tx for user to sign
// POST /api/wallet/withdraw          — request a decommit (withdraw) from the Head

import { Router } from "express";
import { asyncHandler, apiError } from "./middleware";
import { CardanoCliBuilder } from "../tx";
import { config } from "../config";
import type { HydraClient } from "../hydra/client";

export function createWalletRouter(hydra: HydraClient): Router {
  const router = Router();

  const cli = new CardanoCliBuilder({
    cardanoCliPath: config.cardanoCliPath,
    skeyPath:       config.skeyPath,
    testnetMagic:   config.testnetMagic,
  });

  // ── GET /wallet/balance/:address ─────────────────────────────────────────
  // Returns all UTxOs currently in the Head owned by `address`.

  router.get("/balance/:address", asyncHandler(async (req, res) => {
    const { address } = req.params as { address: string };
    const utxos = hydra.getUtxos();

    const mine = Object.entries(utxos)
      .filter(([, u]) => u.address === address)
      .map(([ref, u]) => ({
        ref,
        lovelace: u.value.lovelace ?? 0,
        assets: Object.fromEntries(
          Object.entries(u.value).filter(([k]) => k !== "lovelace")
        ),
      }));

    const totalLovelace = mine.reduce((s, u) => s + Number(u.lovelace), 0);
    res.json({ address, utxos: mine, totalLovelace, headStatus: hydra.getHeadStatus() });
  }));

  // ── POST /wallet/deposit ──────────────────────────────────────────────────
  // Builds a blueprint tx and calls Hydra POST /commit.
  // Hydra returns the actual L1 commit tx CBOR; user signs + submits to L1.
  //
  // Body: {
  //   address:  string,   — L1 address that owns the UTxO
  //   utxoRef:  string,   — "txhash#ix" of the UTxO to commit
  //   lovelace: number,   — lovelace in that UTxO
  //   assets?:  object,   — non-ADA assets (policyId → assetName → qty)
  // }

  router.post("/deposit", asyncHandler(async (req, res) => {
    const { address, utxoRef, lovelace, assets } = req.body as {
      address:  string;
      utxoRef:  string;
      lovelace: number;
      assets?:  Record<string, Record<string, number>>;
    };

    if (!address || !utxoRef || !lovelace) {
      return void apiError(res, 400, "invalid_request", "Missing address, utxoRef, or lovelace");
    }

    // Build a blueprint tx: simple transfer of the UTxO back to owner
    const blueprintRaw = cli.buildBlueprintTx({
      inputRef:      utxoRef,
      inputLovelace: BigInt(lovelace),
      outputAddress: address,
      fee:           0n,
    });

    // Construct the utxo spec expected by Hydra /commit
    const utxoSpec: Record<string, unknown> = {
      address,
      datum:            null,
      datumhash:        null,
      inlineDatum:      null,
      referenceScript:  null,
      value: {
        lovelace,
        ...(assets ?? {}),
      },
    };

    const body = {
      blueprintTx: blueprintRaw,
      utxo:        { [utxoRef]: utxoSpec },
    };

    // Call Hydra node
    const resp = await fetch(`${config.hydraHttpUrl}/commit`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return void apiError(res, 502, "hydra_commit_failed",
        `Hydra /commit returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const commitTx = await resp.json() as { type: string; description: string; cborHex: string };
    res.json({
      commitTxCbor: commitTx.cborHex,
      type:         commitTx.type,
      message:      "Sign commitTxCbor with your wallet and submit it to L1. The UTxO will appear inside the Head after the deposit period.",
    });
  }));

  // ── POST /wallet/withdraw ─────────────────────────────────────────────────
  // Requests an incremental decommit: removes a UTxO from the Head back to L1.
  // For a single-party Head the operator handles this automatically.
  //
  // Body: { utxoRef: string }   — ref of the in-Head UTxO to decommit

  router.post("/withdraw", asyncHandler(async (req, res) => {
    const { utxoRef } = req.body as { utxoRef: string };
    if (!utxoRef) {
      return void apiError(res, 400, "invalid_request", "Missing utxoRef");
    }
    if (!hydra.isOpen()) {
      return void apiError(res, 503, "head_not_open", "Hydra Head is not open");
    }

    const utxos = hydra.getUtxos();
    const utxo = utxos[utxoRef];
    if (!utxo) {
      return void apiError(res, 404, "utxo_not_found",
        `UTxO ${utxoRef} not found in current Head snapshot`);
    }

    const resp = await fetch(`${config.hydraHttpUrl}/decommit`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ utxoToDecommit: { [utxoRef]: utxo } }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return void apiError(res, 502, "hydra_decommit_failed",
        `Hydra /decommit returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    res.json({
      ok:      true,
      utxoRef,
      message: "Decommit requested. The UTxO will be returned to L1 shortly.",
    });
  }));

  // ── POST /wallet/submit-l1-tx ─────────────────────────────────────────────
  // Submits a signed tx CBOR to L1 via Blockfrost.
  // Used after the user signs the commit tx returned by POST /deposit.
  //
  // Body: { signedTxCbor: string }

  router.post("/submit-l1-tx", asyncHandler(async (req, res) => {
    const { signedTxCbor } = req.body as { signedTxCbor: string };
    if (!signedTxCbor || typeof signedTxCbor !== "string") {
      return void apiError(res, 400, "invalid_request", "Missing signedTxCbor");
    }

    const resp = await fetch(`${config.blockfrostUrl}/tx/submit`, {
      method:  "POST",
      headers: {
        project_id:    config.blockfrostApiKey,
        "Content-Type": "application/cbor",
      },
      body: Buffer.from(signedTxCbor, "hex"),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return void apiError(res, 502, "submit_failed",
        `Blockfrost rejected tx: ${text.slice(0, 300)}`);
    }

    const txHash = await resp.json() as string;
    res.json({ ok: true, txHash });
  }));

  // ── GET /wallet/l1-balance/:address ──────────────────────────────────────
  // Returns UTxOs on L1 for a given address, fetched from Blockfrost.

  router.get("/l1-balance/:address", asyncHandler(async (req, res) => {
    const { address } = req.params as { address: string };

    const resp = await fetch(
      `${config.blockfrostUrl}/addresses/${address}/utxos?count=100`,
      { headers: { project_id: config.blockfrostApiKey } }
    );

    if (resp.status === 404) {
      return void res.json({ address, utxos: [], totalLovelace: 0 });
    }
    if (!resp.ok) {
      const text = await resp.text();
      return void apiError(res, 502, "blockfrost_error",
        `Blockfrost returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const raw = await resp.json() as Array<{
      tx_hash: string;
      tx_index: number;
      amount: Array<{ unit: string; quantity: string }>;
    }>;

    const utxos = raw.map((u) => {
      const ada = u.amount.find((a) => a.unit === "lovelace");
      const assets = u.amount
        .filter((a) => a.unit !== "lovelace")
        .reduce<Record<string, string>>((acc, a) => { acc[a.unit] = a.quantity; return acc; }, {});
      return {
        ref:       `${u.tx_hash}#${u.tx_index}`,
        lovelace:  Number(ada?.quantity ?? 0),
        assets,
      };
    });

    const totalLovelace = utxos.reduce((s, u) => s + u.lovelace, 0);
    res.json({ address, utxos, totalLovelace });
  }));

  return router;
}
