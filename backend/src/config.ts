// Central configuration — reads from env vars (populated by .env via dotenv)

export const config = {
  port:           Number(process.env.PORT ?? 3000),
  databaseUrl:    process.env.DATABASE_URL ?? "postgresql://marketplace:marketplace@127.0.0.1:5432/marketplace",
  hydraWsUrl:     process.env.HYDRA_WS_URL   ?? "ws://127.0.0.1:4001",
  hydraHttpUrl:   process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:4001",
  cardanoCliPath: process.env.CARDANO_CLI_PATH ?? "cardano-cli",
  skeyPath:       process.env.SKEY_PATH ?? "",
  testnetMagic:   Number(process.env.TESTNET_MAGIC ?? 1),
  adminSecret:    process.env.ADMIN_SECRET ?? "changeme",

  // Filled in after Epic 8 (Aiken contract compilation)
  scriptCbor:    process.env.SCRIPT_CBOR    ?? "",
  scriptAddress: process.env.SCRIPT_ADDRESS ?? "",

  // Fee to use for inside-Head txs (0 when node uses zero-fee protocol params)
  txFee: BigInt(process.env.TX_FEE ?? "0"),

  // L1 configuration (for FarmerPass and CropToken minting on-chain)
  socketPath:       process.env.CARDANO_NODE_SOCKET_PATH ?? "",
  operatorAddress:  process.env.OPERATOR_ADDRESS ?? "",
  blockfrostUrl:    process.env.BLOCKFROST_URL ?? "https://cardano-preprod.blockfrost.io/api/v0",
  blockfrostApiKey: process.env.BLOCKFROST_PROJECT_ID ?? "",
} as const;
