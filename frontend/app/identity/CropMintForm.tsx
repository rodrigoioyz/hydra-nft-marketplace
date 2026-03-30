"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import { lovelaceToAda } from "@/lib/api";
import type { FarmerRegistration, CropMint } from "@/lib/api";

const CROP_POLICY_ID = process.env.NEXT_PUBLIC_DEMO_POLICY_ID ?? "";

function toAssetNameHex(text: string): string {
  return Array.from(new TextEncoder().encode(text.trim()))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const STATUS_COLOR: Record<string, string> = {
  pending:   "text-yellow-400",
  confirmed: "text-green-400",
  failed:    "text-red-400",
};

export function CropMintForm() {
  const { address, signTx } = useWallet();

  const [registration, setRegistration] = useState<FarmerRegistration | null | "loading">("loading");
  const [crops,        setCrops]        = useState<CropMint[]>([]);
  const [loadingCrops, setLoadingCrops] = useState(false);

  const [cropName,   setCropName]   = useState("");
  const [quantity,   setQuantity]   = useState("");
  const [priceAda,   setPriceAda]   = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [success,    setSuccess]    = useState<string | null>(null);

  const refreshCrops = useCallback(async () => {
    if (!address) return;
    setLoadingCrops(true);
    api.cropList(address).then(setCrops).catch(() => setCrops([])).finally(() => setLoadingCrops(false));
  }, [address]);

  useEffect(() => {
    if (!address) { setRegistration(null); setCrops([]); return; }
    api.farmerStatus(address)
      .then(setRegistration)
      .catch(() => setRegistration(null));
    refreshCrops();
  }, [address, refreshCrops]);

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!address) { setError("Conectá tu billetera"); return; }

    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) { setError("Ingresá una cantidad válida"); return; }
    const pl = Math.round(parseFloat(priceAda) * 1_000_000);
    if (isNaN(pl) || pl < 2_000_000) { setError("El precio mínimo es 2 ADA"); return; }
    if (!cropName.trim()) { setError("Ingresá el nombre del cultivo"); return; }

    setLoading(true);
    try {
      // Step 1: backend builds unsigned L1 tx
      const { mintId, unsignedTxCbor } = await api.cropBuildMintTx({
        farmerAddress: address,
        cropName:      cropName.trim(),
        assetNameHex:  toAssetNameHex(cropName),
        quantity:      qty,
        priceLovelace: pl,
      });

      // Step 2: farmer signs with browser wallet
      const signedTxCbor = await signTx(unsignedTxCbor);

      // Step 3: backend submits to L1
      await api.cropSubmitMintTx({ mintId, signedTxCbor });

      setSuccess(`✓ Lote de ${cropName} minteado en L1. Listalo en Vender para publicarlo.`);
      setCropName(""); setQuantity(""); setPriceAda("");
      refreshCrops();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al mintear");
    } finally {
      setLoading(false);
    }
  }

  if (!address) {
    return (
      <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-4 text-sm text-yellow-300">
        ⚠ Conectá tu billetera para ver tus cultivos.
      </div>
    );
  }

  if (registration === "loading") {
    return <p className="text-sm text-gray-400">Verificando acceso…</p>;
  }

  if (!registration || registration.status !== "approved") {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center space-y-2">
        <p className="text-sm text-gray-400">Necesitás un <strong className="text-white">FarmerPass aprobado</strong> para mintear cultivos.</p>
        <p className="text-xs text-gray-600">
          {registration?.status === "pending"
            ? "Tu solicitud está en revisión. Volvé pronto."
            : "Completá el KYC en la pestaña «Mi Identidad»."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mint form */}
      <form onSubmit={handleMint} className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
        <p className="text-sm text-gray-400">
          Empresa: <span className="text-white font-medium">{registration.companyName}</span>
        </p>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Nombre del cultivo</label>
          <input
            type="text" value={cropName} onChange={(e) => setCropName(e.target.value)}
            placeholder="Ej: Arroz, Soja, Maíz"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Cantidad (unidades)</label>
            <input
              type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ej: 1000" min="1" step="1"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Precio del lote (ADA)</label>
            <input
              type="number" value={priceAda} onChange={(e) => setPriceAda(e.target.value)}
              placeholder="Ej: 40" min="2" step="0.5"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
            />
          </div>
        </div>

        {error   && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-400">{success}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50"
        >
          {loading ? "Minteando…" : "Mintear lote en L1"}
        </button>
      </form>

      {/* Crop history */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Mis lotes registrados</h3>
        {loadingCrops ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : crops.length === 0 ? (
          <p className="text-sm text-gray-600">Todavía no registraste ningún lote.</p>
        ) : (
          <div className="space-y-2">
            {crops.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
                <div>
                  <p className="text-sm text-white font-medium">{c.cropName}</p>
                  <p className="text-xs text-gray-500">{c.quantity.toLocaleString()} unidades · {lovelaceToAda(c.priceLovelace)} ADA</p>
                </div>
                <span className={`text-xs font-medium ${STATUS_COLOR[c.status] ?? "text-gray-400"}`}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
