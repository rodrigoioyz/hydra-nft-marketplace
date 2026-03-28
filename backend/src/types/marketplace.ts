// Domain types for the marketplace

export interface ListingDatum {
  seller: string;       // VerificationKeyHash (hex, 28 bytes)
  policy_id: string;    // hex
  asset_name: string;   // hex
  price: bigint;        // lovelace
}

// Constr encoding for MeshSDK (Mesh format)
export function listingDatumToMesh(d: ListingDatum) {
  return {
    constructor: 0,
    fields: [d.seller, d.policy_id, d.asset_name, Number(d.price)],
  };
}

export type ListingAction =
  | { type: "Buy";    buyer: string }   // buyer VerificationKeyHash
  | { type: "Cancel" };

export function listingActionToMesh(action: ListingAction) {
  if (action.type === "Buy")    return { constructor: 0, fields: [action.buyer] };
  if (action.type === "Cancel") return { constructor: 1, fields: [] };
  throw new Error("Unknown action");
}

export interface ScriptUtxo {
  txHash:     string;
  outputIndex: number;
  datum:      ListingDatum;
  lovelace:   bigint;
  unit:       string;     // policy_id + asset_name
}

export interface BuiltTx {
  txId:    string;
  cborHex: string;
  type:    string;        // "Tx ConwayEra"
}

export interface SignerConfig {
  cardanoCliPath: string;
  skeyPath:       string;
  testnetMagic:   number;
}
