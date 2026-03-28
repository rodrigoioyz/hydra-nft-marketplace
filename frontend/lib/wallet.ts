// CIP-30 wallet integration using @meshsdk/core BrowserWallet
// All functions here are browser-only — never import in server components

import type { BrowserWallet as BrowserWalletType } from "@meshsdk/core";

export interface WalletInfo {
  name: string;
  icon: string;
}

// Detect installed CIP-30 wallets
export async function getInstalledWallets(): Promise<WalletInfo[]> {
  if (typeof window === "undefined") return [];
  const { BrowserWallet } = await import("@meshsdk/core");
  return BrowserWallet.getInstalledWallets();
}

// Connect to a wallet by name (e.g. "eternl", "nami", "lace")
export async function connectWallet(name: string): Promise<BrowserWalletType> {
  const { BrowserWallet } = await import("@meshsdk/core");
  return BrowserWallet.enable(name);
}

// Get the primary address (bech32) from a connected wallet
export async function getWalletAddress(wallet: BrowserWalletType): Promise<string> {
  const addresses = await wallet.getUsedAddresses();
  if (addresses.length > 0) return addresses[0];
  // Fall back to change address if no used addresses yet (fresh wallet)
  return wallet.getChangeAddress();
}

// Sign an unsigned tx CBOR with the connected wallet.
// Returns the fully signed tx CBOR ready to submit.
export async function signTransaction(
  wallet: BrowserWalletType,
  unsignedTxCbor: string
): Promise<string> {
  // partialSign=false: wallet signs the whole tx and returns signed CBOR
  return wallet.signTx(unsignedTxCbor, false);
}
