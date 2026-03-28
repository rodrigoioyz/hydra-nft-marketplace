"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";

function shortAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function WalletConnect() {
  const { address, walletName, connecting, installedWallets, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(name: string) {
    setError(null);
    try {
      await connect(name);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }

  // Connected state — show address + disconnect button
  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-green-700 bg-green-950 px-3 py-1 text-xs text-green-300 font-mono">
          {walletName && <span className="mr-1 capitalize">{walletName}</span>}
          {shortAddr(address)}
        </span>
        <button
          onClick={disconnect}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
          title="Disconnect wallet"
        >
          ✕
        </button>
      </div>
    );
  }

  // Not connected
  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null); }}
        disabled={connecting}
        className="rounded-lg border border-hydra-600 px-3 py-1.5 text-xs font-medium text-hydra-400 hover:bg-hydra-600 hover:text-white transition-colors disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-bold text-white">Connect Wallet</h2>

            {installedWallets.length === 0 && (
              <p className="text-sm text-gray-400">
                No CIP-30 wallet detected. Install{" "}
                <span className="text-hydra-400">Eternl</span>,{" "}
                <span className="text-hydra-400">Nami</span>, or{" "}
                <span className="text-hydra-400">Lace</span>{" "}
                and refresh the page.
              </p>
            )}

            <div className="space-y-2">
              {installedWallets.map((w) => (
                <button
                  key={w.name}
                  onClick={() => handleConnect(w.name)}
                  disabled={connecting}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white hover:border-hydra-500 hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {w.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.icon} alt={w.name} className="h-6 w-6 rounded" />
                  )}
                  <span className="capitalize font-medium">{w.name}</span>
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-lg border border-gray-700 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
