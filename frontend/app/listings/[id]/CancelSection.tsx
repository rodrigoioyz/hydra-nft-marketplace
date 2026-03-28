"use client";

import { useState } from "react";
import { api, newRequestId } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import { useRouter } from "next/navigation";

interface Props { listingId: string; sellerAddress: string; }

export function CancelSection({ listingId, sellerAddress }: Props) {
  const router = useRouter();
  const { address, signTx } = useWallet();
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSeller = !!address && address.toLowerCase() === sellerAddress.toLowerCase();

  async function handleCancel() {
    if (!address) { setError("Connect your wallet first"); return; }
    if (!isSeller) { setError("Connected wallet does not match the seller address"); return; }
    setLoading(true); setError(null); setSuccess(null);
    try {
      const { unsignedTxCbor, txId } = await api.cancelTx(listingId);
      const signedCbor = await signTx(unsignedTxCbor);
      await api.cancel(listingId, {
        requestId: newRequestId(), sellerAddress: address,
        signedCancelTxCbor: signedCbor, txId,
      });
      setSuccess("✓ Listing cancelled");
      setTimeout(() => { setOpen(false); router.refresh(); }, 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "Cancel failed"); }
    finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setError(null); setSuccess(null); }}
        className="w-full rounded-lg border border-gray-700 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors">
        Cancel Listing
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6">
            <h2 className="mb-4 text-lg font-bold text-white">Cancel Listing</h2>
            {!address && <p className="mb-4 text-sm text-yellow-400">⚠ Connect your wallet first.</p>}
            {address && !isSeller && (
              <p className="mb-4 text-sm text-red-400">
                Connected wallet does not match the seller address for this listing.
              </p>
            )}
            {isSeller && (
              <p className="mb-4 text-sm text-gray-400">
                Your wallet will sign the cancel transaction. The NFT will be returned to your address.
              </p>
            )}
            {error   && <p className="mb-3 text-sm text-red-400">{error}</p>}
            {success && <p className="mb-3 text-sm text-green-400">{success}</p>}
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)}
                className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-300 hover:bg-gray-800">
                Back
              </button>
              <button onClick={handleCancel} disabled={loading || !isSeller}
                className="flex-1 rounded-lg bg-red-700 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
                {loading ? "Signing…" : "Sign & Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
