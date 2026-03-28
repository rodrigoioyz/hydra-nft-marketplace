"use client";

import { useState } from "react";
import { api, newRequestId } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import { useRouter } from "next/navigation";

export function SellForm() {
  const router = useRouter();
  const { address, signTx } = useWallet();
  const POLICY_ID = process.env.NEXT_PUBLIC_DEMO_POLICY_ID ?? "";
  const [assetName,    setAssetName]    = useState("");
  const [quantity,     setQuantity]     = useState("");
  const [priceAda,     setPriceAda]     = useState("");
  const [listingId,    setListingId]    = useState<string | null>(null);
  const [escrowTxCbor, setEscrowTxCbor] = useState("");
  const [txId,         setTxId]         = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [success,      setSuccess]      = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!address) { setError("Conectá tu billetera primero"); return; }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { setError("Ingresá la cantidad"); return; }
    const pl = Math.round(parseFloat(priceAda) * 1_000_000);
    if (isNaN(pl) || pl < 2_000_000) { setError("El precio mínimo es 2 ADA"); return; }
    if (!assetName) { setError("Ingresá el nombre del cultivo"); return; }
    // Convertir nombre del cultivo a hex UTF-8
    const assetNameHex = Array.from(new TextEncoder().encode(assetName.trim()))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    setLoading(true);
    try {
      const result = await api.createListing({
        requestId: newRequestId(), sellerAddress: address,
        policyId: POLICY_ID, assetName: assetNameHex,
        priceLovelace: String(pl),
      });
      setListingId(result.listingId);
      setEscrowTxCbor(result.escrowTxCbor);
      setTxId(result.txId);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  async function handleSign(e: React.FormEvent) {
    e.preventDefault(); if (!listingId) return;
    setLoading(true); setError(null);
    try {
      const signedCbor = await signTx(escrowTxCbor);
      await api.escrowConfirm(listingId, { signedTxCbor: signedCbor, txId });
      setSuccess("✓ Listing active! Redirecting…");
      setTimeout(() => router.push(`/listings/${listingId}`), 1500);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  if (listingId) return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
      <div className="rounded-lg border border-green-800 bg-green-950 p-3 text-sm text-green-300">
        ✓ Draft created. Sign the escrow tx with your wallet to activate.
      </div>
      <div>
        <p className="text-sm text-gray-400 mb-1">Unsigned Escrow TX CBOR</p>
        <textarea readOnly value={escrowTxCbor} rows={3}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-mono text-gray-400 resize-none" />
        <p className="mt-1 text-xs text-gray-500">TX ID: {txId}</p>
      </div>
      <form onSubmit={handleSign} className="space-y-3">
        {error   && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-400">{success}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50">
          {loading ? "Signing…" : "Sign with Wallet & Activate"}
        </button>
      </form>
    </div>
  );

  return (
    <form onSubmit={handleCreate} className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
      {!address && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-3 text-sm text-yellow-300">
          ⚠ Conectá tu billetera (arriba a la derecha) antes de publicar.
        </div>
      )}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Tu dirección</label>
        <input type="text" readOnly value={address ?? ""} placeholder="Conectá tu billetera…"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-400 font-mono placeholder-gray-600 focus:outline-none" />
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">Nombre del cultivo</label>
        <input type="text" value={assetName} onChange={(e) => setAssetName(e.target.value)}
          placeholder="Ej: Arroz, Soja, Maíz"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Cantidad (unidades)</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
            placeholder="Ej: 1000" min="1" step="1"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none" />
          <p className="mt-1 text-xs text-gray-600">Cuántas unidades representa este token</p>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Precio del lote (ADA)</label>
          <input type="number" value={priceAda} onChange={(e) => setPriceAda(e.target.value)}
            placeholder="Ej: 40" min="2" step="0.5"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none" />
          <p className="mt-1 text-xs text-gray-600">Lo que recibirás al vender</p>
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={loading || !address}
        className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50">
        {loading ? "Creando…" : "Publicar"}
      </button>
    </form>
  );
}
