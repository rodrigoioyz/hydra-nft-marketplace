// E2E test configuration — override via env vars

export const E2E = {
  apiBase:       process.env["E2E_API_BASE"]       ?? "http://127.0.0.1:3000/api",
  adminKey:      process.env["E2E_ADMIN_KEY"]       ?? "changeme",
  cardanoCliPath:process.env["E2E_CARDANO_CLI"]     ?? "/home/rodrigo/workspace/hydra_test/bin/cardano-cli",
  skeyPath:      process.env["E2E_SKEY_PATH"]       ?? "/home/rodrigo/hydra-nft-marketplace/hydra/keys/cardano.skey",
  sellerAddress: process.env["E2E_SELLER_ADDRESS"]  ?? "addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8",
  // A test NFT that must be present in the Hydra Head snapshot
  testPolicyId:  process.env["E2E_POLICY_ID"]       ?? "",
  testAssetName: process.env["E2E_ASSET_NAME"]      ?? "",  // hex
  testPriceAda:  Number(process.env["E2E_PRICE_ADA"] ?? "2"),
  timeoutMs:     Number(process.env["E2E_TIMEOUT_MS"] ?? "30000"),
};
