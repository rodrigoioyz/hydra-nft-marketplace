// Integration test: build + submit an ADA transfer inside the Hydra Head
// Run: npx tsx test-ada-transfer.ts

import "dotenv/config";
import WebSocket from "ws";
import { CardanoCliBuilder } from "./src/tx";

const HYDRA_WS   = process.env.HYDRA_WS_URL   ?? "ws://127.0.0.1:4001";
const CARDANO_CLI = process.env.CARDANO_CLI_PATH ?? "/home/rodrigo/workspace/hydra_test/bin/cardano-cli";
const SKEY_PATH   = process.env.SKEY_PATH ?? "/home/rodrigo/workspace/hydra_test/keys/cardano.skey";
const TESTNET_MAGIC = Number(process.env.TESTNET_MAGIC ?? 1);

// UTxO from snapshot
const INPUT_REF       = "4f8410ca887e451b3ebe90cd252bd8678e56ac301635f5d81ae857a69c3083ef#0";
const INPUT_LOVELACE  = 5_000_000n;
const MY_ADDRESS      = "addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8";

async function main() {
  const builder = new CardanoCliBuilder({
    cardanoCliPath: CARDANO_CLI,
    skeyPath:       SKEY_PATH,
    testnetMagic:   TESTNET_MAGIC,
  });

  // Build a self-transfer of 1 ADA (zero fee inside Head)
  const tx = builder.buildAdaTransfer({
    inputRef:      INPUT_REF,
    inputLovelace: INPUT_LOVELACE,
    toAddress:     MY_ADDRESS,
    sendLovelace:  1_000_000n,
    changeAddress: MY_ADDRESS,
    fee:           0n,
  });

  console.log("Built tx:", tx.txId);
  console.log("CBOR length:", tx.cborHex.length);

  // Submit via Hydra WebSocket
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(HYDRA_WS);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for TxValid"));
    }, 15_000);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { tag: string; transaction?: { txId: string } };
      console.log("[WS]", msg.tag, (msg as Record<string, unknown>).headStatus ?? "");

      if (msg.tag === "TxValid" && msg.transaction?.txId === tx.txId) {
        console.log("✅ TxValid — transfer confirmed inside Head");
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
      if (msg.tag === "TxInvalid") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error("TxInvalid received: " + raw.toString()));
      }
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({ tag: "NewTx", transaction: { type: tx.type, cborHex: tx.cborHex } }));
      console.log("Sent NewTx for", tx.txId);
    });

    ws.on("error", reject);
  });
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
