// Thin wrapper around cardano-cli for tx building inside Hydra Head
// Used for zero-fee transactions (Hydra protocol-parameters-zero-fees.json)

import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BuiltTx, SignerConfig } from "../types/marketplace";

export class CardanoCliBuilder {
  constructor(private readonly cfg: SignerConfig) {}

  private tmp(): string {
    return mkdtempSync(join(tmpdir(), "marketplace-tx-"));
  }

  // ── T4.2 — ADA transfer ──────────────────────────────────────────────────

  buildAdaTransfer(opts: {
    inputRef:   string;   // "txhash#ix"
    inputLovelace: bigint;
    toAddress:  string;
    sendLovelace: bigint;
    changeAddress: string;
    fee: bigint;
  }): BuiltTx {
    const dir = this.tmp();
    try {
      const unsigned = join(dir, "tx.unsigned.json");
      const signed   = join(dir, "tx.signed.json");

      const change = opts.inputLovelace - opts.sendLovelace - opts.fee;
      if (change < 0n) throw new Error("Insufficient funds for transfer");

      this.cli(
        `latest transaction build-raw` +
        ` --tx-in ${opts.inputRef}` +
        ` --tx-out ${opts.toAddress}+${opts.sendLovelace}` +
        (change > 0n ? ` --tx-out ${opts.changeAddress}+${change}` : "") +
        ` --fee ${opts.fee}` +
        ` --out-file ${unsigned}`
      );

      return this.sign(unsigned, signed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── T4.2 — NFT transfer ───────────────────────────────────────────────────

  buildNftTransfer(opts: {
    inputRef:      string;
    inputLovelace: bigint;
    inputUnit:     string;   // policyId + assetName (hex)
    toAddress:     string;
    minLovelace:   bigint;
    changeAddress: string;
    fee:           bigint;
  }): BuiltTx {
    const dir = this.tmp();
    try {
      const unsigned = join(dir, "tx.unsigned.json");
      const signed   = join(dir, "tx.signed.json");

      const policyId  = opts.inputUnit.slice(0, 56);
      const assetName = opts.inputUnit.slice(56);
      const change    = opts.inputLovelace - opts.minLovelace - opts.fee;
      if (change < 0n) throw new Error("Insufficient lovelace for NFT transfer");

      // NFT output: minLovelace + 1 NFT token
      const nftValue = `${opts.minLovelace} + 1 ${policyId}.${assetName}`;

      this.cli(
        `latest transaction build-raw` +
        ` --tx-in ${opts.inputRef}` +
        ` --tx-out "${opts.toAddress}+${nftValue}"` +
        (change > 0n ? ` --tx-out ${opts.changeAddress}+${change}` : "") +
        ` --fee ${opts.fee}` +
        ` --out-file ${unsigned}`
      );

      return this.sign(unsigned, signed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── T4.3 — Buy tx (script spend) ─────────────────────────────────────────
  // Consumes escrow UTxO, pays seller, sends NFT to buyer.
  // scriptCbor will be provided when Aiken contract is compiled (Epic 8).

  buildBuyTx(opts: {
    escrowRef:      string;   // "txhash#ix" of the script UTxO
    escrowLovelace: bigint;
    collateralRef:  string;   // pure-ADA UTxO for Plutus collateral
    sellerAddress:  string;
    priceLovelace:  bigint;
    buyerAddress:   string;
    unit:           string;   // policyId + assetName
    minLovelace:    bigint;   // min ADA to send with NFT
    scriptCbor:     string;   // compiled Aiken script (filled in Epic 8)
    redeemerCbor:   string;   // JSON of Buy { buyer } redeemer
    fee:            bigint;
  }): BuiltTx {
    const dir = this.tmp();
    try {
      const unsigned     = join(dir, "tx.unsigned.json");
      const signed       = join(dir, "tx.signed.json");
      const scriptFile   = join(dir, "script.plutus");
      const redeemerFile = join(dir, "redeemer.json");

      writeFileSync(scriptFile, JSON.stringify({
        type: "PlutusScriptV3",
        description: "Listing Validator",
        cborHex: opts.scriptCbor,
      }));
      writeFileSync(redeemerFile, opts.redeemerCbor);

      const policyId  = opts.unit.slice(0, 56);
      const assetName = opts.unit.slice(56);
      const nftValue  = `${opts.minLovelace} + 1 ${policyId}.${assetName}`;
      const change    = opts.escrowLovelace - opts.priceLovelace - opts.minLovelace - opts.fee;

      this.cli(
        `latest transaction build-raw` +
        ` --tx-in ${opts.escrowRef}` +
        ` --tx-in-script-file ${scriptFile}` +
        ` --tx-in-inline-datum-present` +
        ` --tx-in-redeemer-file ${redeemerFile}` +
        ` --tx-in-collateral ${opts.collateralRef}` +
        ` --tx-out ${opts.sellerAddress}+${opts.priceLovelace}` +
        ` --tx-out "${opts.buyerAddress}+${nftValue}"` +
        (change > 0n ? ` --tx-out ${opts.buyerAddress}+${change}` : "") +
        ` --fee ${opts.fee}` +
        ` --protocol-params-file ${process.env.PROTOCOL_PARAMS_PATH ?? ""}` +
        ` --out-file ${unsigned}`
      );

      return this.sign(unsigned, signed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── T4.4 — Cancel tx (script spend) ──────────────────────────────────────
  // Consumes escrow UTxO, returns NFT to seller. Requires seller signature.

  buildCancelTx(opts: {
    escrowRef:     string;
    escrowLovelace: bigint;
    sellerAddress:  string;
    sellerVkh:      string;   // VerificationKeyHash for --required-signer-hash
    unit:           string;
    scriptCbor:     string;
    datumCbor:      string;
    redeemerCbor:   string;   // CBOR of Cancel
    fee:            bigint;
  }): BuiltTx {
    const dir = this.tmp();
    try {
      const unsigned    = join(dir, "tx.unsigned.json");
      const signed      = join(dir, "tx.signed.json");
      const scriptFile  = join(dir, "script.plutus");
      const redeemerFile = join(dir, "redeemer.json");

      writeFileSync(scriptFile, JSON.stringify({
        type: "PlutusScriptV3",
        description: "Listing Validator",
        cborHex: opts.scriptCbor,
      }));
      writeFileSync(redeemerFile, opts.redeemerCbor);

      const policyId  = opts.unit.slice(0, 56);
      const assetName = opts.unit.slice(56);
      const minAda    = 2_000_000n;
      const nftValue  = `${minAda} + 1 ${policyId}.${assetName}`;
      const change    = opts.escrowLovelace - minAda - opts.fee;

      this.cli(
        `latest transaction build-raw` +
        ` --tx-in ${opts.escrowRef}` +
        ` --tx-in-script-file ${scriptFile}` +
        ` --tx-in-inline-datum-present` +
        ` --tx-in-redeemer-file ${redeemerFile}` +
        ` --tx-out "${opts.sellerAddress}+${nftValue}"` +
        (change > 0n ? ` --tx-out ${opts.sellerAddress}+${change}` : "") +
        ` --required-signer-hash ${opts.sellerVkh}` +
        ` --fee ${opts.fee}` +
        ` --out-file ${unsigned}`
      );

      return this.sign(unsigned, signed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── T7.1 — Cancel tx (unsigned, for seller to sign) ──────────────────────
  // The script requires sellerVkh in tx.extra_signatories — seller must sign.
  // Returns unsigned CBOR; the frontend wallet adds the vkey witness.

  buildCancelTxUnsigned(opts: {
    escrowRef:      string;
    escrowLovelace: bigint;
    collateralRef:  string;
    sellerAddress:  string;
    sellerVkh:      string;
    unit:           string;
    scriptCbor:     string;
    fee:            bigint;
  }): BuiltTx {
    const dir = this.tmp();
    try {
      const unsigned     = join(dir, "tx.unsigned.json");
      const scriptFile   = join(dir, "script.plutus");
      const redeemerFile = join(dir, "redeemer.json");

      writeFileSync(scriptFile, JSON.stringify({
        type: "PlutusScriptV3",
        description: "Listing Validator",
        cborHex: opts.scriptCbor,
      }));
      // Cancel redeemer: Constr 1 []
      writeFileSync(redeemerFile, JSON.stringify({ constructor: 1, fields: [] }));

      const policyId  = opts.unit.slice(0, 56);
      const assetName = opts.unit.slice(56);
      const minAda    = 2_000_000n;
      const nftValue  = `${minAda} + 1 ${policyId}.${assetName}`;
      const change    = opts.escrowLovelace - minAda - opts.fee;
      if (change < 0n) throw new Error("Insufficient lovelace for cancel tx");

      this.cli(
        `latest transaction build-raw` +
        ` --tx-in ${opts.escrowRef}` +
        ` --tx-in-script-file ${scriptFile}` +
        ` --tx-in-inline-datum-present` +
        ` --tx-in-redeemer-file ${redeemerFile}` +
        ` --tx-in-collateral ${opts.collateralRef}` +
        ` --tx-out "${opts.sellerAddress}+${nftValue}"` +
        (change > 0n ? ` --tx-out ${opts.sellerAddress}+${change}` : "") +
        ` --required-signer-hash ${opts.sellerVkh}` +
        ` --fee ${opts.fee}` +
        ` --out-file ${unsigned}`
      );

      const unsignedTx = JSON.parse(readFileSync(unsigned, "utf8")) as {
        cborHex: string;
        type: string;
      };
      const txIdRaw = this.cli(`latest transaction txid --tx-file ${unsigned}`).trim();
      let txId: string;
      try {
        txId = (JSON.parse(txIdRaw) as { txhash: string }).txhash;
      } catch {
        txId = txIdRaw;
      }
      return { txId, cborHex: unsignedTx.cborHex, type: unsignedTx.type };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── T5.1 — Escrow tx (unsigned, for seller to sign) ──────────────────────
  // Locks NFT at the listing script address with an inline ListingDatum.
  // Returns unsigned CBOR — the frontend wallet adds the vkey witness.

  buildEscrowTxUnsigned(opts: {
    inputRef:      string;   // "txhash#ix" of seller's NFT UTxO in Head
    inputLovelace: bigint;
    inputUnit:     string;   // policyId + assetName (hex)
    sellerAddress: string;
    sellerVkh:     string;   // payment key hash (28-byte hex)
    scriptAddress: string;   // compiled listing validator address
    priceLovelace: bigint;
    minLovelace:   bigint;   // min ADA to send to script UTxO
    fee:           bigint;
  }): BuiltTx {
    const dir = this.tmp();
    try {
      const unsigned  = join(dir, "tx.unsigned.json");
      const datumFile = join(dir, "datum.json");

      const policyId  = opts.inputUnit.slice(0, 56);
      const assetName = opts.inputUnit.slice(56);
      const change    = opts.inputLovelace - opts.minLovelace - opts.fee;
      if (change < 0n) throw new Error("Insufficient lovelace for escrow tx");

      // ListingDatum as cardano-cli detailed-schema JSON
      writeFileSync(datumFile, JSON.stringify({
        constructor: 0,
        fields: [
          { bytes: opts.sellerVkh },
          { bytes: policyId },
          { bytes: assetName },
          { int: Number(opts.priceLovelace) },
        ],
      }));

      const nftValue = `${opts.minLovelace} + 1 ${policyId}.${assetName}`;

      this.cli(
        `latest transaction build-raw` +
        ` --tx-in ${opts.inputRef}` +
        ` --tx-out "${opts.scriptAddress}+${nftValue}"` +
        ` --tx-out-inline-datum-file ${datumFile}` +
        (change > 0n ? ` --tx-out ${opts.sellerAddress}+${change}` : "") +
        ` --fee ${opts.fee}` +
        ` --out-file ${unsigned}`
      );

      // Read unsigned tx file
      const unsignedTx = JSON.parse(readFileSync(unsigned, "utf8")) as {
        cborHex: string;
        type: string;
      };

      // Compute txId from the unsigned tx body
      const txIdRaw = this.cli(`latest transaction txid --tx-file ${unsigned}`).trim();
      let txId: string;
      try {
        txId = (JSON.parse(txIdRaw) as { txhash: string }).txhash;
      } catch {
        txId = txIdRaw;
      }

      return { txId, cborHex: unsignedTx.cborHex, type: unsignedTx.type };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── T4.5 — Validation ────────────────────────────────────────────────────

  validateOutputs(opts: {
    sellerAddress: string;
    priceLovelace: bigint;
    buyerAddress:  string;
    unit:          string;
    tx:            BuiltTx;
  }): void {
    const parsed = JSON.parse(
      execSync(`${this.cfg.cardanoCliPath} latest transaction view --tx-file /dev/stdin`, {
        input: opts.tx.cborHex,
        encoding: "utf8",
      })
    ) as { outputs?: { address: string; value: { lovelace?: number; [k: string]: unknown } }[] };

    const outputs = parsed.outputs ?? [];

    const sellerOut = outputs.find(
      (o) => o.address === opts.sellerAddress &&
             BigInt(o.value.lovelace ?? 0) >= opts.priceLovelace
    );
    if (!sellerOut) throw new Error("Validation: seller not paid correctly");

    const policyId  = opts.unit.slice(0, 56);
    const assetName = opts.unit.slice(56);
    const buyerOut  = outputs.find(
      (o) => o.address === opts.buyerAddress &&
             (o.value[policyId] as Record<string, number>)?.[assetName] === 1
    );
    if (!buyerOut) throw new Error("Validation: NFT not delivered to buyer");
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private cli(args: string): string {
    const cmd = `${this.cfg.cardanoCliPath} ${args}`;
    return execSync(cmd, { encoding: "utf8" });
  }

  private sign(unsignedPath: string, signedPath: string): BuiltTx {
    this.cli(
      `latest transaction sign` +
      ` --tx-file ${unsignedPath}` +
      ` --signing-key-file ${this.cfg.skeyPath}` +
      ` --testnet-magic ${this.cfg.testnetMagic}` +
      ` --out-file ${signedPath}`
    );

    const signed = JSON.parse(readFileSync(signedPath, "utf8")) as {
      cborHex: string;
      type: string;
    };

    const txIdRaw = this.cli(
      `latest transaction txid --tx-file ${signedPath}`
    ).trim();

    // cardano-cli 10+ outputs JSON: {"txhash": "..."} — extract the hash
    let txId: string;
    try {
      txId = (JSON.parse(txIdRaw) as { txhash: string }).txhash;
    } catch {
      txId = txIdRaw;
    }

    return { txId, cborHex: signed.cborHex, type: signed.type };
  }
}
