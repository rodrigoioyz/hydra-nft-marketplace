// L1 minting helpers for FarmerPass (operator-signed) and CropToken (farmer-signed).
// Uses cardano-cli transaction build (auto fee) + the configured cardano-node socket.

import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyParamsToScript, applyCborEncoding } from "@meshsdk/core";
import { config } from "../config";

// ── Blueprint ──────────────────────────────────────────────────────────────────

interface PlutusValidator { title: string; compiledCode: string }

function loadBlueprint(): PlutusValidator[] {
  const path = join(__dirname, "../../../contracts/plutus.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as { validators: PlutusValidator[] };
  return raw.validators;
}

function getMintCompiledCode(validators: PlutusValidator[], namePrefix: string): string {
  const v = validators.find((v) => v.title.startsWith(namePrefix) && v.title.includes(".mint"));
  if (!v) throw new Error(`Validator ${namePrefix}.mint not found in plutus.json`);
  return v.compiledCode;
}

// ── Script helpers ─────────────────────────────────────────────────────────────

function parameterise(compiledCode: string, params: string[]): string {
  return applyParamsToScript(applyCborEncoding(compiledCode), params);
}

function writePlutusFile(dir: string, filename: string, cborHex: string): string {
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify({ type: "PlutusScriptV3", description: "", cborHex }));
  return path;
}

function getPolicyId(scriptPath: string): string {
  return cli(`latest transaction policyid --script-file ${scriptPath}`).trim();
}

// ── UTxO querying ──────────────────────────────────────────────────────────────

export interface UtxoEntry {
  ref:      string;   // "txhash#ix"
  lovelace: bigint;
  value:    Record<string, unknown>;
}

// Returns the raw cardano-cli UTxO map — compatible with Hydra's /commit body format.
export function queryL1UtxosFull(address: string): Record<string, unknown> {
  if (!config.socketPath) throw new Error("CARDANO_NODE_SOCKET_PATH not set in backend/.env");
  const dir     = mkdtempSync(join(tmpdir(), "utxo-"));
  const outFile = join(dir, "utxo.json");
  try {
    cli(
      `latest query utxo` +
      ` --address ${address}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --socket-path ${config.socketPath}` +
      ` --out-file ${outFile}`
    );
    const raw = readFileSync(outFile, "utf8").trim();
    if (!raw || raw === "{}") return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function queryL1Utxos(address: string): UtxoEntry[] {
  if (!config.socketPath) throw new Error("CARDANO_NODE_SOCKET_PATH not set in backend/.env");
  const dir    = mkdtempSync(join(tmpdir(), "utxo-"));
  const outFile = join(dir, "utxo.json");
  try {
    cli(
      `latest query utxo` +
      ` --address ${address}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --socket-path ${config.socketPath}` +
      ` --out-file ${outFile}`
    );
    const raw = readFileSync(outFile, "utf8").trim();
    if (!raw || raw === "{}") return [];
    const map = JSON.parse(raw) as Record<string, { value: Record<string, unknown> }>;
    return Object.entries(map).map(([ref, data]) => ({
      ref,
      lovelace: BigInt((data.value["lovelace"] as number | undefined) ?? 0),
      value: data.value,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function findPureAdaUtxo(utxos: UtxoEntry[], minLovelace: bigint, exclude?: string): UtxoEntry | null {
  return utxos.find(
    (u) => u.ref !== exclude &&
           Object.keys(u.value).every((k) => k === "lovelace") &&
           u.lovelace >= minLovelace
  ) ?? null;
}

// ── Script cache ───────────────────────────────────────────────────────────────

export interface L1Scripts {
  farmerPassCbor:    string;
  farmerPassPolicyId: string;
  cropTokenCbor:     string;
  cropTokenPolicyId: string;
  operatorPkh:       string;
}

let _scripts: L1Scripts | null = null;

export function getL1Scripts(): L1Scripts {
  if (_scripts) return _scripts;
  if (!config.operatorAddress) throw new Error("OPERATOR_ADDRESS not set in backend/.env");

  const operatorPkh = getOperatorPkh();
  const validators  = loadBlueprint();
  const dir         = mkdtempSync(join(tmpdir(), "l1scripts-"));

  try {
    const farmerPassCbor    = parameterise(getMintCompiledCode(validators, "farmer_pass"), [operatorPkh]);
    const fpFile            = writePlutusFile(dir, "farmer_pass.plutus", farmerPassCbor);
    const farmerPassPolicyId = getPolicyId(fpFile);

    const cropTokenCbor     = parameterise(getMintCompiledCode(validators, "crop_token"), [farmerPassPolicyId, operatorPkh]);
    const ctFile            = writePlutusFile(dir, "crop_token.plutus", cropTokenCbor);
    const cropTokenPolicyId = getPolicyId(ctFile);

    _scripts = { farmerPassCbor, farmerPassPolicyId, cropTokenCbor, cropTokenPolicyId, operatorPkh };
    console.log("[L1] FarmerPass policyId:", farmerPassPolicyId);
    console.log("[L1] CropToken  policyId:", cropTokenPolicyId);
    return _scripts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function getOperatorPkh(): string {
  // Extract PKH from bech32 address using cardano-cli
  const raw = cli(`latest address info --address ${config.operatorAddress}`);
  const info = JSON.parse(raw) as { base16?: string };
  if (!info.base16) throw new Error("Could not parse operator address");
  return info.base16.slice(2); // strip 1-byte header
}

// ── FarmerPass mint (operator-signed, automatic) ───────────────────────────────

export function mintFarmerPassL1(opts: {
  farmerAddress: string;
  farmerPkh:     string;    // 56-char hex (28 bytes)
  companyName:   string;
  identityHash:  string;    // 64-char hex sha256
}): string {
  const scripts = getL1Scripts();
  const { farmerPassCbor, farmerPassPolicyId, operatorPkh } = scripts;
  const dir = mkdtempSync(join(tmpdir(), "fp-mint-"));

  try {
    const scriptFile   = writePlutusFile(dir, "fp.plutus", farmerPassCbor);
    const redeemerFile = join(dir, "redeemer.json");
    const datumFile    = join(dir, "datum.json");
    const unsignedFile = join(dir, "tx.unsigned");
    const signedFile   = join(dir, "tx.signed");

    // Redeemer: _redeemer is ignored by the validator, any Data works
    writeFileSync(redeemerFile, JSON.stringify({ constructor: 0, fields: [] }));

    // FarmerPassDatum: { company_name: ByteArray, identity_hash: ByteArray, issued_at: Int }
    const companyNameHex = Buffer.from(opts.companyName, "utf8").toString("hex");
    writeFileSync(datumFile, JSON.stringify({
      constructor: 0,
      fields: [
        { bytes: companyNameHex },
        { bytes: opts.identityHash },
        { int: Math.floor(Date.now() / 1000) },
      ],
    }));

    // Token name = farmer PKH (enforced by convention, checked in has_farmer_pass)
    const tokenUnit  = `${farmerPassPolicyId}.${opts.farmerPkh}`;
    const mintClause = `1 ${tokenUnit}`;
    const outValue   = `2000000 + ${mintClause}`;

    // Select operator UTxOs for input + collateral
    const opUtxos = queryL1Utxos(config.operatorAddress);
    const inputUtxo = findPureAdaUtxo(opUtxos, 5_000_000n);
    if (!inputUtxo) throw new Error("Operator needs ≥ 5 ADA on L1 (preprod). Send ADA to: " + config.operatorAddress);
    const collUtxo  = findPureAdaUtxo(opUtxos, 5_000_000n, inputUtxo.ref) ?? inputUtxo;

    // Build (auto fee + execution units)
    cli(
      `latest transaction build` +
      ` --socket-path ${config.socketPath}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --tx-in ${inputUtxo.ref}` +
      ` --tx-in-collateral ${collUtxo.ref}` +
      ` --tx-out "${opts.farmerAddress}+${outValue}"` +
      ` --tx-out-inline-datum-file ${datumFile}` +
      ` --change-address ${config.operatorAddress}` +
      ` --mint "${mintClause}"` +
      ` --minting-script-file ${scriptFile}` +
      ` --mint-redeemer-file ${redeemerFile}` +
      ` --required-signer-hash ${operatorPkh}` +
      ` --out-file ${unsignedFile}`
    );

    // Sign with operator key
    cli(
      `latest transaction sign` +
      ` --tx-file ${unsignedFile}` +
      ` --signing-key-file ${config.skeyPath}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --out-file ${signedFile}`
    );

    // Submit to L1
    cli(
      `latest transaction submit` +
      ` --socket-path ${config.socketPath}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --tx-file ${signedFile}`
    );

    return resolveTxId(signedFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── CropToken mint (unsigned, farmer must sign) ────────────────────────────────

export function buildCropMintTxUnsigned(opts: {
  farmerAddress:     string;
  farmerPkh:         string;
  farmerPassUtxoRef: string;  // "<txHash>#0" of FarmerPass NFT on L1
  assetNameHex:      string;  // UTF-8 hex of crop name
  quantity:          number;
}): { cborHex: string; txId: string } {
  const scripts = getL1Scripts();
  const { cropTokenCbor, cropTokenPolicyId } = scripts;
  const dir = mkdtempSync(join(tmpdir(), "crop-mint-"));

  try {
    const scriptFile   = writePlutusFile(dir, "ct.plutus", cropTokenCbor);
    const redeemerFile = join(dir, "redeemer.json");
    const unsignedFile = join(dir, "tx.unsigned");

    // MintCrop { farmer_pkh } → Constr 0 [farmer_pkh bytes]
    writeFileSync(redeemerFile, JSON.stringify({
      constructor: 0,
      fields: [{ bytes: opts.farmerPkh }],
    }));

    const tokenUnit  = `${cropTokenPolicyId}.${opts.assetNameHex}`;
    const mintClause = `${opts.quantity} ${tokenUnit}`;
    const outValue   = `2000000 + ${mintClause}`;

    // Farmer's L1 UTxOs
    const farmerUtxos = queryL1Utxos(opts.farmerAddress);
    const inputUtxo   = farmerUtxos.find((u) => u.lovelace >= 4_000_000n) ?? null;
    if (!inputUtxo) throw new Error("Farmer needs ≥ 4 ADA on L1 to cover fee + min-ADA. Fund: " + opts.farmerAddress);
    const collUtxo    = findPureAdaUtxo(farmerUtxos, 5_000_000n, inputUtxo.ref) ?? inputUtxo;

    // Build unsigned tx (no --signing-key-file → farmer signs in browser)
    cli(
      `latest transaction build` +
      ` --socket-path ${config.socketPath}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --tx-in ${inputUtxo.ref}` +
      ` --tx-in-collateral ${collUtxo.ref}` +
      ` --read-only-tx-in-reference ${opts.farmerPassUtxoRef}` +
      ` --tx-out "${opts.farmerAddress}+${outValue}"` +
      ` --change-address ${opts.farmerAddress}` +
      ` --mint "${mintClause}"` +
      ` --minting-script-file ${scriptFile}` +
      ` --mint-redeemer-file ${redeemerFile}` +
      ` --required-signer-hash ${opts.farmerPkh}` +
      ` --out-file ${unsignedFile}`
    );

    const parsed = JSON.parse(readFileSync(unsignedFile, "utf8")) as { cborHex: string };
    return { cborHex: parsed.cborHex, txId: resolveTxId(unsignedFile) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── L1 submission (farmer's signed CBOR) ──────────────────────────────────────

export function submitL1Tx(signedCborHex: string): string {
  const dir = mkdtempSync(join(tmpdir(), "l1submit-"));
  try {
    const txFile = join(dir, "tx.signed");
    writeFileSync(txFile, JSON.stringify({ type: "Tx ConwayEra", description: "", cborHex: signedCborHex }));
    cli(
      `latest transaction submit` +
      ` --socket-path ${config.socketPath}` +
      ` --testnet-magic ${config.testnetMagic}` +
      ` --tx-file ${txFile}`
    );
    return resolveTxId(txFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Private helpers ────────────────────────────────────────────────────────────

function cli(args: string): string {
  return execSync(`${config.cardanoCliPath} ${args}`, { encoding: "utf8" });
}

function resolveTxId(txFilePath: string): string {
  const raw = cli(`latest transaction txid --tx-file ${txFilePath}`).trim();
  try { return (JSON.parse(raw) as { txhash: string }).txhash; }
  catch { return raw; }
}
