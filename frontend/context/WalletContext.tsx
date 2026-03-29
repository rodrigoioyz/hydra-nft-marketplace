"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { BrowserWallet } from "@meshsdk/core";
import {
  connectWallet,
  getInstalledWallets,
  getWalletAddress,
  signTransaction,
  type WalletInfo,
} from "@/lib/wallet";

interface WalletContextValue {
  wallet:           BrowserWallet | null;
  address:          string | null;
  walletName:       string | null;
  connecting:       boolean;
  installedWallets: WalletInfo[];
  connect:          (name: string) => Promise<void>;
  disconnect:       () => void;
  signTx:           (unsignedCbor: string, partialSign?: boolean) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet,           setWallet]           = useState<BrowserWallet | null>(null);
  const [address,          setAddress]          = useState<string | null>(null);
  const [walletName,       setWalletName]       = useState<string | null>(null);
  const [connecting,       setConnecting]       = useState(false);
  const [installedWallets, setInstalledWallets] = useState<WalletInfo[]>([]);

  // Detect installed wallets on mount (client only)
  useEffect(() => {
    getInstalledWallets().then(setInstalledWallets).catch(() => {});
  }, []);

  // Re-connect from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("connectedWallet");
    if (saved) connect(saved).catch(() => localStorage.removeItem("connectedWallet"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(async (name: string) => {
    setConnecting(true);
    try {
      const w   = await connectWallet(name);
      const addr = await getWalletAddress(w);
      setWallet(w);
      setAddress(addr);
      setWalletName(name);
      localStorage.setItem("connectedWallet", name);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setAddress(null);
    setWalletName(null);
    localStorage.removeItem("connectedWallet");
  }, []);

  const signTx = useCallback(async (unsignedCbor: string, partialSign = false): Promise<string> => {
    if (!wallet) throw new Error("No wallet connected");
    return signTransaction(wallet, unsignedCbor, partialSign);
  }, [wallet]);

  return (
    <WalletContext.Provider
      value={{ wallet, address, walletName, connecting, installedWallets, connect, disconnect, signTx }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
