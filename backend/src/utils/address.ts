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
  // First byte is the address header; remaining 28 bytes are the payment key hash
  return info.base16.slice(2); // strip the 1-byte (2 hex chars) header
}
