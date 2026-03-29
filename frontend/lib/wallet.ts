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

// Sign a tx CBOR with the connected wallet.
// partialSign=true: wallet adds its witness without removing existing witnesses
// (used for multi-sig txs where another party already signed).
export async function signTransaction(
  wallet: BrowserWalletType,
  unsignedTxCbor: string,
  partialSign = false
): Promise<string> {
  return wallet.signTx(unsignedTxCbor, partialSign);
}
