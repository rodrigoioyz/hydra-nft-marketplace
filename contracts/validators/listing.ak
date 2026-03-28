use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address, VerificationKey}
use cardano/assets.{AssetName, PolicyId, lovelace_of, quantity_of}
use cardano/transaction.{Output, OutputReference, Transaction}

// ── Types ─────────────────────────────────────────────────────────────────────

pub type ListingDatum {
  seller: VerificationKeyHash,
  policy_id: PolicyId,
  asset_name: AssetName,
  price: Int,
}

pub type ListingAction {
  Buy { buyer: VerificationKeyHash }
  Cancel
}

// ── Validator ─────────────────────────────────────────────────────────────────

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
        seller_paid(tx.outputs, datum.seller, datum.price) && buyer_receives_nft(
          tx.outputs,
          buyer,
          datum.policy_id,
          datum.asset_name,
        )

      Cancel ->
        seller_signed(tx.extra_signatories, datum.seller) && nft_returned(
          tx.outputs,
          datum.seller,
          datum.policy_id,
          datum.asset_name,
        )
    }
  }

  else(_) {
    fail
  }
}

// ── Helper functions ──────────────────────────────────────────────────────────

fn seller_paid(
  outputs: List<Output>,
  seller: VerificationKeyHash,
  price: Int,
) -> Bool {
  list.any(
    outputs,
    fn(o) {
      o.address.payment_credential == VerificationKey(seller) && lovelace_of(
        o.value,
      ) >= price
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
      o.address.payment_credential == VerificationKey(buyer) && quantity_of(
        o.value,
        policy_id,
        asset_name,
      ) == 1
    },
  )
}

fn seller_signed(
  signatories: List<VerificationKeyHash>,
  seller: VerificationKeyHash,
) -> Bool {
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
      o.address.payment_credential == VerificationKey(seller) && quantity_of(
        o.value,
        policy_id,
        asset_name,
      ) == 1
    },
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Shared test fixtures
const seller_vkh: VerificationKeyHash =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const buyer_vkh: VerificationKeyHash =
  #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

const third_party_vkh: VerificationKeyHash =
  #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

const policy: PolicyId =
  #"aabbccddeeff00112233445566778899aabbccddeeff001122334455"

const nft_name: AssetName = #"4e4654"

const price_lovelace: Int = 5_000_000

fn seller_addr() -> Address {
  Address {
    payment_credential: VerificationKey(seller_vkh),
    stake_credential: None,
  }
}

fn buyer_addr() -> Address {
  Address {
    payment_credential: VerificationKey(buyer_vkh),
    stake_credential: None,
  }
}

fn third_party_addr() -> Address {
  Address {
    payment_credential: VerificationKey(third_party_vkh),
    stake_credential: None,
  }
}

fn seller_output_with_price() -> Output {
  Output {
    address: seller_addr(),
    value: assets.from_lovelace(price_lovelace),
    datum: transaction.NoDatum,
    reference_script: None,
  }
}

fn nft_value() {
  assets.add(assets.from_lovelace(2_000_000), policy, nft_name, 1)
}

fn nft_output_to(addr: Address) -> Output {
  Output {
    address: addr,
    value: nft_value(),
    datum: transaction.NoDatum,
    reference_script: None,
  }
}

// ── Buy: valid ────────────────────────────────────────────────────────────────

test buy_valid() {
  let outputs =
    [seller_output_with_price(), nft_output_to(buyer_addr())]
  seller_paid(outputs, seller_vkh, price_lovelace) && buyer_receives_nft(
    outputs,
    buyer_vkh,
    policy,
    nft_name,
  )
}

test buy_valid_excess_ada_to_seller() {
  let val = assets.from_lovelace(price_lovelace + 1_000_000)
  let seller_out =
    Output {
      address: seller_addr(),
      value: val,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let outputs =
    [seller_out, nft_output_to(buyer_addr())]
  seller_paid(outputs, seller_vkh, price_lovelace) && buyer_receives_nft(
    outputs,
    buyer_vkh,
    policy,
    nft_name,
  )
}

// ── Buy: invalid ──────────────────────────────────────────────────────────────

test buy_seller_underpaid() fail {
  let val = assets.from_lovelace(price_lovelace - 1)
  let seller_out =
    Output {
      address: seller_addr(),
      value: val,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let outputs =
    [seller_out, nft_output_to(buyer_addr())]
  seller_paid(outputs, seller_vkh, price_lovelace)
}

test buy_seller_output_missing() fail {
  let outputs =
    [nft_output_to(buyer_addr())]
  seller_paid(outputs, seller_vkh, price_lovelace)
}

test buy_wrong_nft_policy() fail {
  let wrong_policy: PolicyId =
    #"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  let wrong_val =
    assets.add(assets.from_lovelace(2_000_000), wrong_policy, nft_name, 1)
  let wrong_nft =
    Output {
      address: buyer_addr(),
      value: wrong_val,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let outputs =
    [seller_output_with_price(), wrong_nft]
  buyer_receives_nft(outputs, buyer_vkh, policy, nft_name)
}

test buy_wrong_nft_name() fail {
  let wrong_name: AssetName = #"999999"
  let wrong_val =
    assets.add(assets.from_lovelace(2_000_000), policy, wrong_name, 1)
  let wrong_nft =
    Output {
      address: buyer_addr(),
      value: wrong_val,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let outputs =
    [seller_output_with_price(), wrong_nft]
  buyer_receives_nft(outputs, buyer_vkh, policy, nft_name)
}

test buy_nft_quantity_zero() fail {
  let zero_nft =
    Output {
      address: buyer_addr(),
      value: assets.from_lovelace(2_000_000),
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let outputs =
    [seller_output_with_price(), zero_nft]
  buyer_receives_nft(outputs, buyer_vkh, policy, nft_name)
}

test buy_nft_quantity_two() fail {
  let two_val =
    assets.add(assets.from_lovelace(2_000_000), policy, nft_name, 2)
  let two_nft =
    Output {
      address: buyer_addr(),
      value: two_val,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let outputs =
    [seller_output_with_price(), two_nft]
  buyer_receives_nft(outputs, buyer_vkh, policy, nft_name)
}

test buy_nft_to_wrong_address() fail {
  let outputs =
    [seller_output_with_price(), nft_output_to(third_party_addr())]
  buyer_receives_nft(outputs, buyer_vkh, policy, nft_name)
}

// ── Cancel: valid ─────────────────────────────────────────────────────────────

test cancel_valid() {
  let outputs =
    [nft_output_to(seller_addr())]
  seller_signed([seller_vkh], seller_vkh) && nft_returned(
    outputs,
    seller_vkh,
    policy,
    nft_name,
  )
}

// ── Cancel: invalid ───────────────────────────────────────────────────────────

test cancel_no_signature() fail {
  seller_signed([], seller_vkh)
}

test cancel_nft_not_returned() fail {
  let outputs: List<Output> =
    []
  nft_returned(outputs, seller_vkh, policy, nft_name)
}

test cancel_nft_to_wrong_address() fail {
  let outputs =
    [nft_output_to(third_party_addr())]
  nft_returned(outputs, seller_vkh, policy, nft_name)
}

test cancel_wrong_signer() fail {
  seller_signed([third_party_vkh], seller_vkh)
}
