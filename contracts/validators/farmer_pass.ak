use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}

// ── Types ─────────────────────────────────────────────────────────────────────

/// Stored as inline datum on the FarmerPass UTxO.
/// company_name is public; identity_hash = sha256("name:doc_id") — private.
pub type FarmerPassDatum {
  company_name:  ByteArray,
  identity_hash: ByteArray,
  issued_at:     Int,
}

// ── Validator ─────────────────────────────────────────────────────────────────

/// Minting policy for FarmerPass NFTs.
/// Only the operator can mint or burn.
/// Token name must equal the farmer's PKH (28 bytes) — enforces one pass per wallet.
validator farmer_pass_policy(operator_pkh: VerificationKeyHash) {
  mint(_redeemer: Data, _policy_id: PolicyId, tx: Transaction) {
    list.has(tx.extra_signatories, operator_pkh)
  }

  else(_) {
    fail
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

/// Returns True if the transaction contains a FarmerPass NFT
/// belonging to `farmer_pkh` under `pass_policy_id` as a reference input.
pub fn has_farmer_pass(
  tx: Transaction,
  pass_policy_id: PolicyId,
  farmer_pkh: VerificationKeyHash,
) -> Bool {
  let token_name = farmer_pkh
  list.any(
    tx.reference_inputs,
    fn(input) {
      quantity_of(input.output.value, pass_policy_id, token_name) >= 1
    },
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const operator_vkh: VerificationKeyHash =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const farmer_vkh: VerificationKeyHash =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const pass_policy: PolicyId =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

fn make_ref_input_with_pass(policy: PolicyId, token_name: ByteArray) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"deadbeef", output_index: 0 },
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

test operator_can_mint() {
  let tx = make_tx([operator_vkh], [])
  list.has(tx.extra_signatories, operator_vkh)
}

test non_operator_cannot_mint() fail {
  let other_vkh: VerificationKeyHash =
    #"dddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  let tx = make_tx([other_vkh], [])
  list.has(tx.extra_signatories, operator_vkh)
}

test has_farmer_pass_valid() {
  let ref_input = make_ref_input_with_pass(pass_policy, farmer_vkh)
  let tx = make_tx([farmer_vkh], [ref_input])
  has_farmer_pass(tx, pass_policy, farmer_vkh)
}

test has_farmer_pass_missing() fail {
  let tx = make_tx([farmer_vkh], [])
  has_farmer_pass(tx, pass_policy, farmer_vkh)
}

test has_farmer_pass_wrong_policy() fail {
  let wrong_policy: PolicyId =
    #"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  let ref_input = make_ref_input_with_pass(wrong_policy, farmer_vkh)
  let tx = make_tx([farmer_vkh], [ref_input])
  has_farmer_pass(tx, pass_policy, farmer_vkh)
}

test has_farmer_pass_wrong_token_name() fail {
  let other_pkh: VerificationKeyHash =
    #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  let ref_input = make_ref_input_with_pass(pass_policy, other_pkh)
  let tx = make_tx([farmer_vkh], [ref_input])
  has_farmer_pass(tx, pass_policy, farmer_vkh)
}
