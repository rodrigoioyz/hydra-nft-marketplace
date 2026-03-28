# Aiken Validator Specification — Hydra NFT Marketplace

Plutus version: V3
Aiken stdlib: v3.0.0
Network: Cardano preprod

---

## 1. Types

```aiken
pub type ListingDatum {
  seller: ByteArray,      // VerificationKeyHash (28 bytes)
  policy_id: ByteArray,   // PolicyId (28 bytes)
  asset_name: ByteArray,  // AssetName (hex encoded)
  price: Int,             // lovelace, must be > 0
}

pub type ListingAction {
  Buy { buyer: ByteArray }  // buyer VerificationKeyHash
  Cancel
}
```

---

## 2. Validator: `listing`

Guards the escrow UTxO. Called when the escrow UTxO is spent.

```
validator listing(datum: ListingDatum, redeemer: ListingAction, ctx: ScriptContext) -> Bool
```

### 2.1 Buy — formal conditions

**ALL of the following must hold:**

| # | Condition | Description |
|---|-----------|-------------|
| B1 | `seller_output_exists(tx, datum.seller, datum.price)` | There is an output paying ≥ `datum.price` lovelace to the seller's payment credential |
| B2 | `buyer_receives_nft(tx, redeemer.buyer, datum.policy_id, datum.asset_name)` | There is an output sending exactly 1 token of `(datum.policy_id, datum.asset_name)` to the buyer's payment credential |
| B3 | `escrow_utxo_consumed(tx, ctx.purpose)` | The script UTxO being validated appears in `tx.inputs` (guaranteed by Plutus execution) |

**No owner signature required** — payment to seller is the authorization.

#### Formal definition of B1

```
∃ output ∈ tx.outputs such that:
  output.address.payment_credential = VerificationKeyCredential(datum.seller)
  ∧ lovelace_of(output.value) ≥ datum.price
```

#### Formal definition of B2

```
∃ output ∈ tx.outputs such that:
  output.address.payment_credential = VerificationKeyCredential(redeemer.buyer)
  ∧ quantity_of(output.value, datum.policy_id, datum.asset_name) = 1
```

---

### 2.2 Cancel — formal conditions

**ALL of the following must hold:**

| # | Condition | Description |
|---|-----------|-------------|
| C1 | `seller_signed(tx, datum.seller)` | `datum.seller` appears in `tx.extra_signatories` |
| C2 | `nft_returned_to_seller(tx, datum.seller, datum.policy_id, datum.asset_name)` | There is an output sending the NFT back to the seller |

#### Formal definition of C1

```
datum.seller ∈ tx.extra_signatories
```

#### Formal definition of C2

```
∃ output ∈ tx.outputs such that:
  output.address.payment_credential = VerificationKeyCredential(datum.seller)
  ∧ quantity_of(output.value, datum.policy_id, datum.asset_name) = 1
```

---

## 3. Fail conditions (exhaustive)

Any of these causes the validator to return `False`:

| Case | Redeemer | Violated condition | Description |
|------|-----------|--------------------|-------------|
| F1 | Buy | B1 | Seller output missing or ADA < price |
| F2 | Buy | B2 | Buyer output missing NFT |
| F3 | Buy | B2 | Buyer output has wrong policy_id or asset_name |
| F4 | Buy | B2 | Buyer output has quantity ≠ 1 |
| F5 | Cancel | C1 | Seller did not sign the transaction |
| F6 | Cancel | C2 | NFT not returned to seller address |
| F7 | Cancel | C2 | NFT returned to wrong address |

---

## 4. Aiken implementation sketch

```aiken
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{Transaction, Output, InlineDatum}
use cardano/assets.{PolicyId, AssetName, quantity_of, lovelace_of}
use cardano/address.{Address, VerificationKeyCredential}

pub type ListingDatum {
  seller:     VerificationKeyHash,
  policy_id:  PolicyId,
  asset_name: AssetName,
  price:      Int,
}

pub type ListingAction {
  Buy { buyer: VerificationKeyHash }
  Cancel
}

validator listing {
  spend(
    datum_opt: Option<ListingDatum>,
    redeemer: ListingAction,
    _utxo: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt

    when redeemer is {
      Buy { buyer } ->
        seller_paid(tx.outputs, datum.seller, datum.price) &&
        buyer_receives_nft(tx.outputs, buyer, datum.policy_id, datum.asset_name)

      Cancel ->
        seller_signed(tx.extra_signatories, datum.seller) &&
        nft_returned(tx.outputs, datum.seller, datum.policy_id, datum.asset_name)
    }
  }

  else(_) {
    fail
  }
}

fn seller_paid(outputs: List<Output>, seller: VerificationKeyHash, price: Int) -> Bool {
  list.any(
    outputs,
    fn(o) {
      o.address.payment_credential == VerificationKeyCredential(seller) &&
      lovelace_of(o.value) >= price
    },
  )
}

fn buyer_receives_nft(
  outputs: List<Output>,
  buyer: VerificationKeyHash,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Bool {
  list.any(
    outputs,
    fn(o) {
      o.address.payment_credential == VerificationKeyCredential(buyer) &&
      quantity_of(o.value, policy_id, asset_name) == 1
    },
  )
}

fn seller_signed(signatories: List<VerificationKeyHash>, seller: VerificationKeyHash) -> Bool {
  list.has(signatories, seller)
}

fn nft_returned(
  outputs: List<Output>,
  seller: VerificationKeyHash,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Bool {
  list.any(
    outputs,
    fn(o) {
      o.address.payment_credential == VerificationKeyCredential(seller) &&
      quantity_of(o.value, policy_id, asset_name) == 1
    },
  )
}
```

---

## 5. Test specification

Every test must pass before the validator is considered complete.

### Buy — valid cases

| Test | Setup | Expected |
|------|-------|----------|
| `buy_valid` | Seller gets ≥ price ADA; buyer gets NFT | `True` |
| `buy_valid_excess_ada_to_seller` | Seller gets price + extra ADA | `True` |

### Buy — invalid cases

| Test | Setup | Expected |
|------|-------|----------|
| `buy_seller_underpaid` | Seller output = price - 1 lovelace | `False` |
| `buy_seller_output_missing` | No output to seller | `False` |
| `buy_wrong_nft_policy` | Buyer gets NFT with different policy_id | `False` |
| `buy_wrong_nft_name` | Buyer gets NFT with different asset_name | `False` |
| `buy_nft_quantity_zero` | Buyer output has NFT quantity 0 | `False` |
| `buy_nft_quantity_two` | Buyer output has NFT quantity 2 | `False` |
| `buy_nft_to_wrong_address` | NFT sent to third party, not buyer | `False` |

### Cancel — valid cases

| Test | Setup | Expected |
|------|-------|----------|
| `cancel_valid` | Seller signs; NFT returned to seller | `True` |

### Cancel — invalid cases

| Test | Setup | Expected |
|------|-------|----------|
| `cancel_no_signature` | Seller not in extra_signatories | `False` |
| `cancel_nft_not_returned` | NFT goes to third party | `False` |
| `cancel_nft_to_wrong_address` | NFT returned to wrong address | `False` |
| `cancel_wrong_signer` | Third party signs, not seller | `False` |

---

## 6. MeshSDK integration — transaction building

### 6.1 List (create escrow UTxO)

```typescript
import { MeshTxBuilder, BlockfrostProvider, deserializeAddress } from "@meshsdk/core"

// Lock NFT at script address with ListingDatum
const tx = new MeshTxBuilder({ fetcher: blockfrost, evaluator: blockfrost })

await tx
  .txIn(sellerUtxo.txHash, sellerUtxo.outputIndex)        // NFT source
  .txOut(scriptAddress, [                                   // escrow output
    { unit: "lovelace", quantity: "2000000" },              // min ADA
    { unit: policyId + assetName, quantity: "1" },         // NFT
  ])
  .txOutInlineDatumValue({                                  // ListingDatum
    constructor: 0,
    fields: [
      sellerPkh,       // seller: ByteArray
      policyId,        // policy_id: ByteArray
      assetName,       // asset_name: ByteArray
      priceLovelace,   // price: Int
    ],
  }, "JSON")
  .changeAddress(sellerAddress)
  .complete()
```

### 6.2 Buy (spend escrow UTxO, pay seller, deliver NFT)

```typescript
await tx
  .txIn(escrowTxHash, escrowUtxoIx, escrowDatum, scriptCbor)  // spend escrow
  .txInRedeemerValue({ constructor: 0, fields: [buyerPkh] }, "JSON")  // Buy { buyer }
  .txOut(sellerAddress, [                                       // pay seller
    { unit: "lovelace", quantity: priceLovelace.toString() },
  ])
  .txOut(buyerAddress, [                                        // deliver NFT
    { unit: "lovelace", quantity: "2000000" },                  // min ADA
    { unit: policyId + assetName, quantity: "1" },
  ])
  .changeAddress(operatorAddress)
  .complete()
```

### 6.3 Cancel (spend escrow UTxO, return NFT to seller)

```typescript
await tx
  .txIn(escrowTxHash, escrowUtxoIx, escrowDatum, scriptCbor)  // spend escrow
  .txInRedeemerValue({ constructor: 1, fields: [] }, "JSON")   // Cancel
  .txOut(sellerAddress, [                                       // return NFT
    { unit: "lovelace", quantity: "2000000" },
    { unit: policyId + assetName, quantity: "1" },
  ])
  .requiredSignerHash(sellerPkh)                                // C1: seller must sign
  .changeAddress(sellerAddress)
  .complete()
// Seller must sign the tx before submission
```

### 6.4 Submit to Hydra (NewTx)

```typescript
// After tx is built and signed:
const signedTxCbor = tx.txHex

ws.send(JSON.stringify({
  tag: "NewTx",
  transaction: {
    cborHex: signedTxCbor,
    description: "",
    type: "Tx BabbageEra",
  }
}))
```

---

## 7. Script address derivation (preprod)

```typescript
import { serializePlutusScript, resolvePlutusScriptHash } from "@meshsdk/core"

const scriptAddress = serializePlutusScript(
  { code: compiledValidatorCbor, version: "V3" },
  undefined,
  0,  // network: 0 = testnet
).address
```

The `compiledValidatorCbor` comes from `plutus.json` after `aiken build`, wrapped with `applyCborEncoding` as required by MeshSDK.
