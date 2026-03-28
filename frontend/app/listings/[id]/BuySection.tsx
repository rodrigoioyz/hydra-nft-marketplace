"use client";

import { useState } from "react";
import { api, newRequestId, lovelaceToAda } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";

interface Props { listingId: string; priceLovelace: string; }

export function BuySection({ listingId, priceLovelace }: Props) {
  const { address } = useWallet();
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleBuy() {
    if (!address) { setError("Connect your wallet first"); return; }
    setLoading(true); setError(null); setSuccess(null);
    try {
      await api.buy(listingId, { requestId: newRequestId(), buyerAddress: address });
      setSuccess("✓ Purchase submitted! Waiting for Hydra confirmation…");
      setTimeout(() => { setOpen(false); window.location.reload(); }, 2500);
    } catch (e) { setError(e instanceof Error ? e.message : "Purchase failed"); }
    finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setError(null); setSuccess(null); }}
        className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 transition-colors">
        Buy for {lovelaceToAda(priceLovelace)} ADA
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-bold text-white">Confirm Purchase</h2>
            <p className="mb-4 text-sm text-gray-400">
              You are buying this NFT for{" "}
              <span className="text-white font-semibold">{lovelaceToAda(priceLovelace)} ADA</span>.
              The trade executes instantly inside the Hydra Head.
            </p>
            {!address
              ? <p className="mb-4 text-sm text-yellow-400">⚠ Connect your wallet (navbar) to proceed.</p>
              : <p className="mb-4 text-xs text-gray-500 font-mono break-all">NFT will be sent to: {address}</p>
            }
            {error   && <p className="mb-3 text-sm text-red-400">{error}</p>}
            {success && <p className="mb-3 text-sm text-green-400">{success}</p>}
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)}
                className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-300 hover:bg-gray-800">
                Cancel
              </button>
              <button onClick={handleBuy} disabled={loading || !address}
                className="flex-1 rounded-lg bg-hydra-600 py-2 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50">
                {loading ? "Submitting…" : "Confirm Buy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
