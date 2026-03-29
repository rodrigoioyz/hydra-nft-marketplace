// MeshSDK-based tx builder — replaces cardano-cli for all Hydra Head transactions.
// No shell spawning; uses @meshsdk/core-csl WASM serializer directly.

import { readFileSync } from "fs";
import { CSLSerializer } from "@meshsdk/core-csl";
import { emptyTxBuilderBody, DEFAULT_PROTOCOL_PARAMETERS, resolveTxHash } from "@meshsdk/core";
import type { BuiltTx, SignerConfig } from "../types/marketplace";

// Zero-fee protocol parameters for Hydra Head (no fees charged)
const HYDRA_PARAMS = {
  ...DEFAULT_PROTOCOL_PARAMETERS,
  minFeeA: 0,
  minFeeB: 0,
};

// Hydra executes scripts for free — use max ex-units for all Plutus scripts.
const HYDRA_EX_UNITS = { mem: 16_000_000, steps: 10_000_000_000 };

/** Read operator signing key from a cardano-cli .skey file and return raw 32-byte hex. */
function readSkeyHex(skeyPath: string): string {
  if (!skeyPath) throw new Error("SKEY_PATH not configured");
  const skey = JSON.parse(readFileSync(skeyPath, "utf8")) as { cborHex: string };
  // cborHex is CBOR-encoded: "5820" prefix (32-byte bytestring) + 64 hex chars of private key
  if (skey.cborHex.startsWith("5820")) return skey.cborHex.slice(4);
  // Already raw hex (some key formats)
  return skey.cborHex;
}

function datumJson(content: object): object {
  return { type: "JSON", content: JSON.stringify(content) };
}

function redeemerJson(content: object): object {
  return { type: "JSON", content: JSON.stringify(content) };
}

export class MeshTxBuilderWrapper {
  private readonly serializer = new CSLSerializer();

  constructor(private readonly cfg: SignerConfig) {}

  // ── T5.1 — Escrow tx (unsigned, for seller to sign) ──────────────────────
  // Locks NFT at the listing script address with an inline ListingDatum.

  buildEscrowTxUnsigned(opts: {
    inputRef:      string;    // "txhash#ix" of seller's NFT UTxO in Head
    inputLovelace: bigint;
    inputUnit:     string;    // policyId + assetName (hex)
    sellerAddress: string;
    sellerVkh:     string;    // payment key hash (28-byte hex)
    scriptAddress: string;
    priceLovelace: bigint;
    minLovelace:   bigint;
    fee:           bigint;
  }): BuiltTx {
    const [inputTxHash, inputTxIndex] = opts.inputRef.split("#") as [string, string];
    const policyId  = opts.inputUnit.slice(0, 56);
    const assetName = opts.inputUnit.slice(56);
    const change    = opts.inputLovelace - opts.minLovelace - opts.fee;
    if (change < 0n) throw new Error("Insufficient lovelace for escrow tx");

    const body = emptyTxBuilderBody();
    body.network = "preprod";
    body.fee     = String(opts.fee);

    body.inputs = [{
      type: "PubKey",
      txIn: {
        txHash:  inputTxHash,
        txIndex: Number(inputTxIndex),
        amount:  [
          { unit: "lovelace", quantity: String(opts.inputLovelace) },
          { unit: opts.inputUnit,   quantity: "1" },
        ],
        address: opts.sellerAddress,
      },
    }];

    const scriptOutput: (typeof body.outputs)[0] = {
      address: opts.scriptAddress,
      amount:  [
        { unit: "lovelace", quantity: String(opts.minLovelace) },
        { unit: opts.inputUnit,   quantity: "1" },
      ],
      datum: {
        type: "Inline",
        data: datumJson({
          constructor: 0,
          fields: [
            { bytes: opts.sellerVkh },
            { bytes: policyId },
            { bytes: assetName },
            { int: Number(opts.priceLovelace) },
          ],
        }),
      },
    };

    body.outputs = change > 0n
      ? [scriptOutput, { address: opts.sellerAddress, amount: [{ unit: "lovelace", quantity: String(change) }] }]
      : [scriptOutput];

    body.changeAddress = opts.sellerAddress;

    const cborHex = this.serializer.serializeTxBody(body, HYDRA_PARAMS);
    const txId    = resolveTxHash(cborHex);
    return { txId, cborHex, type: "Tx ConwayEra" };
  }

  // ── T6.1 — Buy tx (operator signs) ────────────────────────────────────────
  // Consumes escrow UTxO, pays seller, sends NFT to buyer.

  buildBuyTx(opts: {
    escrowRef:      string;
    escrowLovelace: bigint;
    collateralRef:  string;
    sellerAddress:  string;
    priceLovelace:  bigint;
    buyerAddress:   string;
    unit:           string;
    minLovelace:    bigint;
    scriptCbor:     string;
    redeemerCbor:   string;   // JSON string: { constructor, fields }
    fee:            bigint;
  }): BuiltTx {
    const [escrowTxHash, escrowTxIndex]       = opts.escrowRef.split("#") as [string, string];
    const [collateralTxHash, collateralTxIndex] = opts.collateralRef.split("#") as [string, string];

    const redeemer = JSON.parse(opts.redeemerCbor) as { constructor: number; fields: { bytes: string }[] };
    const buyerVkh = redeemer.fields[0]?.bytes ?? "";

    const change = opts.escrowLovelace - opts.priceLovelace - opts.minLovelace - opts.fee;

    const body = emptyTxBuilderBody();
    body.network = "preprod";
    body.fee     = String(opts.fee);

    body.inputs = [{
      type: "Script",
      txIn: {
        txHash:  escrowTxHash,
        txIndex: Number(escrowTxIndex),
        amount:  [
          { unit: "lovelace", quantity: String(opts.escrowLovelace) },
          { unit: opts.unit,   quantity: "1" },
        ],
        address: "", // script address (not needed for spending)
      },
      scriptTxIn: {
        scriptSource: {
          type:   "Provided",
          script: { code: opts.scriptCbor, version: "V3" },
        },
        datumSource: { type: "Inline" },
        redeemer: {
          data:    redeemerJson({ constructor: 0, fields: [{ bytes: buyerVkh }] }),
          exUnits: HYDRA_EX_UNITS,
        },
      },
    }];

    body.collaterals = [{
      type: "PubKey",
      txIn: {
        txHash:  collateralTxHash,
        txIndex: Number(collateralTxIndex),
        amount:  [{ unit: "lovelace", quantity: "5000000" }],
        address: "",
      },
    }];

    body.outputs = [
      { address: opts.sellerAddress, amount: [{ unit: "lovelace", quantity: String(opts.priceLovelace) }] },
      { address: opts.buyerAddress,  amount: [{ unit: "lovelace", quantity: String(opts.minLovelace) }, { unit: opts.unit, quantity: "1" }] },
      ...(change > 0n ? [{ address: opts.buyerAddress, amount: [{ unit: "lovelace", quantity: String(change) }] }] : []),
    ];

    body.changeAddress = opts.buyerAddress;

    const unsigned  = this.serializer.serializeTxBody(body, HYDRA_PARAMS);
    const skeyHex   = readSkeyHex(this.cfg.skeyPath);
    const cborHex   = this.serializer.addSigningKeys(unsigned, [skeyHex]);
    const txId      = resolveTxHash(cborHex);
    return { txId, cborHex, type: "Tx ConwayEra" };
  }

  // ── T7.1 — Cancel tx (unsigned, for seller to sign) ──────────────────────
  // Consumes escrow UTxO, returns NFT to seller.

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
    const [escrowTxHash, escrowTxIndex]         = opts.escrowRef.split("#") as [string, string];
    const [collateralTxHash, collateralTxIndex] = opts.collateralRef.split("#") as [string, string];

    const minAda = 2_000_000n;
    const change = opts.escrowLovelace - minAda - opts.fee;
    if (change < 0n) throw new Error("Insufficient lovelace for cancel tx");

    const body = emptyTxBuilderBody();
    body.network = "preprod";
    body.fee     = String(opts.fee);

    body.inputs = [{
      type: "Script",
      txIn: {
        txHash:  escrowTxHash,
        txIndex: Number(escrowTxIndex),
        amount:  [
          { unit: "lovelace", quantity: String(opts.escrowLovelace) },
          { unit: opts.unit,   quantity: "1" },
        ],
        address: "",
      },
      scriptTxIn: {
        scriptSource: {
          type:   "Provided",
          script: { code: opts.scriptCbor, version: "V3" },
        },
        datumSource: { type: "Inline" },
        redeemer: {
          data:    redeemerJson({ constructor: 1, fields: [] }),
          exUnits: HYDRA_EX_UNITS,
        },
      },
    }];

    body.collaterals = [{
      type: "PubKey",
      txIn: {
        txHash:  collateralTxHash,
        txIndex: Number(collateralTxIndex),
        amount:  [{ unit: "lovelace", quantity: "5000000" }],
        address: "",
      },
    }];

    body.outputs = [
      { address: opts.sellerAddress, amount: [{ unit: "lovelace", quantity: String(minAda) }, { unit: opts.unit, quantity: "1" }] },
      ...(change > 0n ? [{ address: opts.sellerAddress, amount: [{ unit: "lovelace", quantity: String(change) }] }] : []),
    ];

    body.changeAddress      = opts.sellerAddress;
    body.requiredSignatures = [opts.sellerVkh];

    const cborHex = this.serializer.serializeTxBody(body, HYDRA_PARAMS);
    const txId    = resolveTxHash(cborHex);
    return { txId, cborHex, type: "Tx ConwayEra" };
  }
}
