use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}
use farmer_pass.{has_farmer_pass}

// ── Types ─────────────────────────────────────────────────────────────────────

pub type CropAction {
  MintCrop { farmer_pkh: VerificationKeyHash }
  BurnCrop { owner_pkh: VerificationKeyHash }
}

// ── Validator ─────────────────────────────────────────────────────────────────

/// Minting policy for fungible crop tokens (Arroz, Soja, Maíz, etc).
///
/// Mint: tx must include a FarmerPass reference input belonging to the signer.
/// Burn: tx must be signed by the token owner OR the operator.
///
/// Token name = UTF-8 hex of the crop name (e.g. "6172726f7a" for "arroz").
/// Quantity = number of real-world units in the lot.
validator crop_token_policy(
  farmer_pass_policy_id: PolicyId,
  operator_pkh: VerificationKeyHash,
) {
  mint(redeemer: CropAction, _policy_id: PolicyId, tx: Transaction) {
    when redeemer is {
      MintCrop { farmer_pkh } ->
        // Farmer must sign the tx
        list.has(tx.extra_signatories, farmer_pkh) && // Farmer must have a valid FarmerPass as reference input
        has_farmer_pass(tx, farmer_pass_policy_id, farmer_pkh)

      BurnCrop { owner_pkh } ->
        // Owner or operator can burn
        list.has(tx.extra_signatories, owner_pkh) || list.has(
          tx.extra_signatories,
          operator_pkh,
        )
    }
  }

  else(_) {
    fail
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const operator_vkh: VerificationKeyHash =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const farmer_vkh: VerificationKeyHash =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const other_vkh: VerificationKeyHash =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const pass_policy: PolicyId =
  #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

fn make_pass_ref_input(policy: PolicyId, token_name: ByteArray) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"cafebabe", output_index: 0 },
    output: Output {
      address: Address {
        payment_credential: VerificationKey(farmer_vkh),
        stake_credential: None,
      },
      value: assets.add(assets.from_lovelace(2_000_000), policy, token_name, 1),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn make_tx(
  signatories: List<VerificationKeyHash>,
  ref_inputs: List<Input>,
) -> Transaction {
  Transaction {
    ..transaction.placeholder,
    extra_signatories: signatories,
    reference_inputs: ref_inputs,
  }
}

test mint_valid_with_farmer_pass() {
  let ref_input = make_pass_ref_input(pass_policy, farmer_vkh)
  let tx = make_tx([farmer_vkh], [ref_input])
  list.has(tx.extra_signatories, farmer_vkh) && has_farmer_pass(
    tx,
    pass_policy,
    farmer_vkh,
  )
}

test mint_fails_no_farmer_pass() fail {
  let tx = make_tx([farmer_vkh], [])
  list.has(tx.extra_signatories, farmer_vkh) && has_farmer_pass(
    tx,
    pass_policy,
    farmer_vkh,
  )
}

test mint_fails_no_signature() fail {
  let ref_input = make_pass_ref_input(pass_policy, farmer_vkh)
  let tx = make_tx([], [ref_input])
  list.has(tx.extra_signatories, farmer_vkh) && has_farmer_pass(
    tx,
    pass_policy,
    farmer_vkh,
  )
}

test burn_valid_by_owner() {
  let tx = make_tx([farmer_vkh], [])
  list.has(tx.extra_signatories, farmer_vkh) || list.has(
    tx.extra_signatories,
    operator_vkh,
  )
}

test burn_valid_by_operator() {
  let tx = make_tx([operator_vkh], [])
  list.has(tx.extra_signatories, farmer_vkh) || list.has(
    tx.extra_signatories,
    operator_vkh,
  )
}

test burn_fails_no_authorized_signer() fail {
  let tx = make_tx([other_vkh], [])
  list.has(tx.extra_signatories, farmer_vkh) || list.has(
    tx.extra_signatories,
    operator_vkh,
  )
}
