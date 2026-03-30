import { execSync } from "child_process";

// Extract the payment key hash (28-byte hex) from a Shelley enterprise/base address.
// Uses: cardano-cli latest address info → base16 → strip 1-byte header.
export function getPaymentKeyHash(cardanoCliPath: string, address: string): string {
  const raw = execSync(
    `${cardanoCliPath} latest address info --address ${address}`,
    { encoding: "utf8" }
  );
  const info = JSON.parse(raw) as { base16?: string };
  if (!info.base16) throw new Error(`Could not parse address info for ${address}`);
  // First byte is the address header; next 28 bytes are the payment key hash.
  // Base addresses also contain a 28-byte staking key hash after the payment key
  // hash — slice to exactly 56 hex chars (28 bytes) to get payment key only.
  return info.base16.slice(2, 58); // header=2 hex, payment key hash=56 hex
}
