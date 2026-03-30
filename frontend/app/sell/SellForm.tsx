"use client";

import { useState, useEffect, useCallback } from "react";
import { api, newRequestId } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import { useRouter } from "next/navigation";
import type { FarmerRegistration, CropWalletAsset, HeadStatus, EscrowInfo } from "@/lib/api";

function decodeHexToUtf8(hex: string): string {
  try {
    return decodeURIComponent(hex.replace(/../g, "%$&"));
  } catch {
    return hex;
  }
}

interface TokenWithStatus extends CropWalletAsset {
  inHead: boolean;
}

export function SellForm() {
  const router = useRouter();
  const { address, signTx } = useWallet();

  const [farmer,     setFarmer]     = useState<FarmerRegistration | null | "loading">("loading");
  const [tokens,     setTokens]     = useState<TokenWithStatus[] | "loading" | null>(null);
  const [selected,   setSelected]   = useState<TokenWithStatus | null>(null);
  const [headStatus, setHeadStatus] = useState<HeadStatus | null>(null);

  const [myEscrows,     setMyEscrows]     = useState<EscrowInfo[]>([]);
  const [recoverStates, setRecoverStates] = useState<Record<string, "idle" | "signing" | "submitting" | "done" | "error">>({});
  const [recoverErrors, setRecoverErrors] = useState<Record<string, string | null>>({});

  const [quantity, setQuantity] = useState("");
  const [priceAda, setPriceAda] = useState("");

  // Listing step 2
  const [listingId,        setListingId]        = useState<string | null>(null);
  const [escrowTxCbor,     setEscrowTxCbor]     = useState("");
  const [txId,             setTxId]             = useState("");
  const [needsPartialSign, setNeedsPartialSign] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadHeadStatus = useCallback(async () => {
    try { setHeadStatus(await api.headStatus()); } catch { /* ignore */ }
  }, []);

  const loadTokens = useCallback(async (addr: string) => {
    setTokens("loading");
    try {
      const [walletAssets, headUtxos] = await Promise.all([
        api.cropWalletAssets(addr),
        fetch("/api/head/utxos")
          .then((r) => r.json() as Promise<Record<string, { value: Record<string, unknown>; address: string }>>)
          .catch(() => ({})),
      ]);

      const headTokenMap = new Map<string, number>();
      for (const u of Object.values(headUtxos)) {
        if (u.address !== addr) continue;
        for (const [pid, tokenMap] of Object.entries(u.value)) {
          if (pid === "lovelace") continue;
          for (const [assetName, qty] of Object.entries(tokenMap as Record<string, number>)) {
            const key = `${pid}.${assetName}`;
            headTokenMap.set(key, (headTokenMap.get(key) ?? 0) + qty);
          }
        }
      }

      const seen = new Set<string>();
      const enriched: TokenWithStatus[] = walletAssets.map((t) => {
        const key = `${t.policyId}.${t.assetNameHex}`;
        seen.add(key);
        return { ...t, inHead: headTokenMap.has(key) };
      });

      for (const [key, qty] of headTokenMap.entries()) {
        if (seen.has(key)) continue;
        const [policyId, assetNameHex] = key.split(".");
        enriched.push({
          policyId, assetNameHex,
          assetName: decodeHexToUtf8(assetNameHex),
          quantity: qty,
          inHead: true,
        });
      }

      setTokens(enriched);
      if (enriched.length === 1) setSelected(enriched[0]);
    } catch {
      setTokens([]);
    }
  }, []);

  const loadEscrows = useCallback(async (addr: string) => {
    try {
      const { escrows } = await api.myEscrows(addr);
      setMyEscrows(escrows.filter((e) => e.inHead));
    } catch {
      setMyEscrows([]);
    }
  }, []);

  useEffect(() => {
    void loadHeadStatus();
    if (!address) {
      setFarmer(null); setTokens(null); setSelected(null); setMyEscrows([]);
      return;
    }
    setFarmer("loading");
    api.farmerStatus(address).then(setFarmer).catch(() => setFarmer(null));
    loadTokens(address);
    loadEscrows(address);
  }, [address, loadTokens, loadHeadStatus, loadEscrows]);

  const farmerApproved  = farmer !== "loading" && farmer?.status === "approved";
  const marketplaceOpen = headStatus?.status?.toLowerCase() === "open";

  // ── Recover token stuck in escrow ─────────────────────────────────────────
  async function handleRecover(escrowId: string) {
    setRecoverStates((s) => ({ ...s, [escrowId]: "signing" }));
    setRecoverErrors((s) => ({ ...s, [escrowId]: null }));
    try {
      if (!address) throw new Error("No wallet connected");
      const { unsignedTxCbor, txId: cancelTxId } = await api.cancelTx(escrowId);
      const signedCbor = await signTx(unsignedTxCbor, true);
      setRecoverStates((s) => ({ ...s, [escrowId]: "submitting" }));
      await api.cancel(escrowId, {
        requestId: newRequestId(), sellerAddress: address,
        signedCancelTxCbor: signedCbor, txId: cancelTxId,
      });
      setRecoverStates((s) => ({ ...s, [escrowId]: "done" }));
      setTimeout(() => {
        if (address) { void loadTokens(address); void loadEscrows(address); }
      }, 3000);
    } catch (e) {
      setRecoverErrors((s) => ({ ...s, [escrowId]: e instanceof Error ? e.message : "Error al recuperar" }));
      setRecoverStates((s) => ({ ...s, [escrowId]: "error" }));
    }
  }

  // ── Create listing (step 1) ────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!address)  { setError("Conectá tu billetera primero"); return; }
    if (!selected) { setError("Seleccioná un token"); return; }
    if (!selected.inHead) { setError("Este token aún no está habilitado para publicar. Contactá al administrador."); return; }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { setError("Ingresá la cantidad"); return; }
    if (qty > selected.quantity) { setError(`Solo tenés ${selected.quantity} unidades disponibles`); return; }
    const pl = Math.round(parseFloat(priceAda) * 1_000_000);
    if (isNaN(pl) || pl < 2_000_000) { setError("El precio mínimo es 2 ADA"); return; }

    setLoading(true);
    try {
      const result = await api.createListing({
        requestId: newRequestId(), sellerAddress: address,
        policyId: selected.policyId, assetName: selected.assetNameHex,
        priceLovelace: String(pl),
      });
      setListingId(result.listingId);
      setEscrowTxCbor(result.escrowTxCbor);
      setTxId(result.txId);
      setNeedsPartialSign(result.needsPartialSign ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear listing");
    } finally {
      setLoading(false);
    }
  }

  // ── Sign escrow (step 2) ───────────────────────────────────────────────────
  async function handleSign(e: React.FormEvent) {
    e.preventDefault(); if (!listingId) return;
    setLoading(true); setError(null);
    try {
      const signedCbor = await signTx(escrowTxCbor, needsPartialSign);
      await api.escrowConfirm(listingId, { signedTxCbor: signedCbor, txId });
      setSuccess("✓ Publicación activa. Redirigiendo…");
      setTimeout(() => router.push(`/listings/${listingId}`), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al firmar");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2 UI ──────────────────────────────────────────────────────────────
  if (listingId) return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
      <div className="rounded-lg border border-green-800 bg-green-950 p-3 text-sm text-green-300">
        ✓ Publicación creada. Firmá con tu billetera para activarla.
      </div>
      <form onSubmit={handleSign} className="space-y-3">
        {error   && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-400">{success}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50">
          {loading ? "Firmando…" : "Firmar con Billetera y Activar"}
        </button>
      </form>
    </div>
  );

  // ── Step 1 UI ──────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleCreate} className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-5">

      {/* Status banners */}
      {!address && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-3 text-sm text-yellow-300">
          ⚠ Conectá tu billetera (arriba a la derecha) antes de publicar.
        </div>
      )}
      {address && farmer === "loading" && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-400">
          Verificando acceso…
        </div>
      )}
      {address && farmer !== "loading" && !farmerApproved && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">
          ⚠ Solo productores verificados pueden publicar cultivos.{" "}
          {farmer?.status === "pending"
            ? "Tu solicitud está en revisión — te avisaremos cuando sea aprobada."
            : <><a href="/identity" className="underline hover:text-red-200">Completá tu perfil</a> para solicitar acceso.</>}
        </div>
      )}

      {/* Marketplace status */}
      {headStatus && !marketplaceOpen && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-400 flex items-center justify-between">
          <span>El marketplace no está disponible en este momento.</span>
          <button type="button" onClick={loadHeadStatus} className="text-xs opacity-70 hover:opacity-100 ml-2">↺</button>
        </div>
      )}

      {/* Recover active escrows */}
      {marketplaceOpen && myEscrows.length > 0 && (
        <div className="space-y-2">
          {myEscrows.map((esc) => {
            const state = recoverStates[esc.id] ?? "idle";
            const err   = recoverErrors[esc.id];
            if (state === "done") return (
              <div key={esc.id} className="rounded-lg border border-green-800 bg-green-950 p-3 text-sm text-green-300">
                ✓ {esc.displayName ?? esc.assetName} recuperado.
              </div>
            );
            return (
              <div key={esc.id} className="rounded-lg border border-orange-800 bg-orange-950 p-4 space-y-2">
                <p className="text-sm text-orange-200 font-medium">Publicación sin vender</p>
                <p className="text-xs text-orange-400">
                  <strong>{esc.displayName ?? esc.assetName}</strong> está publicado. Cancelá para recuperarlo.
                </p>
                {err && <p className="text-sm text-red-400">{err}</p>}
                <button type="button" onClick={() => { void handleRecover(esc.id); }}
                  disabled={state === "signing" || state === "submitting" || !address}
                  className="w-full rounded-lg bg-orange-700 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
                  {state === "signing"    ? "Esperando firma de billetera…"
                    : state === "submitting" ? "Cancelando publicación…"
                    : "Recuperar token (cancelar publicación)"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Token picker */}
      {farmerApproved && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Tus cultivos</label>
            {address && (
              <button type="button"
                onClick={() => { void loadTokens(address); void loadHeadStatus(); void loadEscrows(address); }}
                className="text-xs text-hydra-400 hover:text-hydra-300">
                ↺ Actualizar
              </button>
            )}
          </div>

          {tokens === "loading" && (
            <p className="text-sm text-gray-500">Consultando tus cultivos…</p>
          )}

          {tokens !== "loading" && tokens !== null && tokens.length === 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-400 text-center">
              No tenés cultivos disponibles.{" "}
              <a href="/identity" className="underline text-hydra-400 hover:text-hydra-300">
                Mintealos en Identidad
              </a>.
            </div>
          )}

          {tokens !== "loading" && tokens !== null && tokens.length > 0 && (
            <div className="grid gap-2">
              {tokens.map((t) => (
                <button key={t.assetNameHex} type="button"
                  onClick={() => { setSelected(t); setQuantity(String(t.quantity)); setError(null); }}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                    selected?.assetNameHex === t.assetNameHex
                      ? "border-hydra-500 bg-hydra-950 text-white"
                      : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <div>
                    <p className="font-medium text-sm">{t.assetName}</p>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                      {t.policyId.slice(0, 12)}…{t.policyId.slice(-6)}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm font-semibold tabular-nums">{t.quantity.toLocaleString()} uds.</p>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                      t.inHead ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-400"
                    }`}>
                      {t.inHead ? "Disponible ✓" : "Pendiente de habilitación"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Token not yet tradeable */}
      {selected && !selected.inHead && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-4 text-sm text-yellow-300">
          ⚠ Este cultivo aún no está habilitado para publicar. Contactá al administrador.
        </div>
      )}

      {/* Quantity + price */}
      {selected?.inHead && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Cantidad a vender <span className="text-gray-600">(máx {selected.quantity})</span>
            </label>
            <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ej: 500" min="1" max={selected.quantity} step="1"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Precio del lote (ADA)</label>
            <input type="number" value={priceAda} onChange={(e) => setPriceAda(e.target.value)}
              placeholder="Ej: 40" min="2" step="0.5"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-600">Lo que recibirás al vender</p>
          </div>
        </div>
      )}

      {error   && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}

      <button type="submit"
        disabled={loading || !address || !farmerApproved || !selected || !selected.inHead || !marketplaceOpen}
        className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50">
        {loading ? "Creando publicación…"
          : !selected ? "Seleccioná un cultivo"
          : !selected.inHead ? "Cultivo pendiente de habilitación"
          : !marketplaceOpen ? "Marketplace no disponible"
          : `Publicar ${selected.assetName}`}
      </button>
    </form>
  );
}
