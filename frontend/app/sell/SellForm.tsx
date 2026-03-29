"use client";

import { useState, useEffect, useCallback } from "react";
import { api, newRequestId } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import { useRouter } from "next/navigation";
import type { FarmerRegistration, CropWalletAsset, HeadStatus } from "@/lib/api";

// Token enriched with Head presence status
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

  const [quantity,     setQuantity]     = useState("");
  const [priceAda,     setPriceAda]     = useState("");

  // Listing (step 2)
  const [listingId,    setListingId]    = useState<string | null>(null);
  const [escrowTxCbor, setEscrowTxCbor] = useState("");
  const [txId,         setTxId]         = useState("");

  // Commit flow
  const [committing,   setCommitting]   = useState(false);
  const [commitDone,   setCommitDone]   = useState<string | null>(null); // txHash
  // Collecting (opening the Head after commit)
  const [collecting,   setCollecting]   = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadHeadStatus = useCallback(async () => {
    try {
      const hs = await api.headStatus();
      setHeadStatus(hs);
    } catch {
      // ignore
    }
  }, []);

  const loadTokens = useCallback(async (addr: string) => {
    setTokens("loading");
    try {
      const [walletAssets, headUtxos] = await Promise.all([
        api.cropWalletAssets(addr),
        fetch("/api/head/utxos").then((r) => r.json() as Promise<Record<string, { value: Record<string, unknown>; address: string }>>).catch(() => ({})),
      ]);

      // Build a set of (policyId + assetNameHex) present in the Head at this address
      const headTokens = new Set<string>();
      for (const u of Object.values(headUtxos)) {
        if (u.address !== addr) continue;
        for (const [pid, tokens] of Object.entries(u.value)) {
          if (pid === "lovelace") continue;
          for (const assetName of Object.keys(tokens as Record<string, unknown>)) {
            headTokens.add(`${pid}.${assetName}`);
          }
        }
      }

      const enriched: TokenWithStatus[] = walletAssets.map((t) => ({
        ...t,
        inHead: headTokens.has(`${t.policyId}.${t.assetNameHex}`),
      }));
      setTokens(enriched);
      if (enriched.length === 1) setSelected(enriched[0]);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void loadHeadStatus();
    if (!address) {
      setFarmer(null);
      setTokens(null);
      setSelected(null);
      return;
    }
    setFarmer("loading");
    api.farmerStatus(address)
      .then(setFarmer)
      .catch(() => setFarmer(null));
    loadTokens(address);
  }, [address, loadTokens, loadHeadStatus]);

  const farmerApproved = farmer !== "loading" && farmer?.status === "approved";
  const headIsOpen = headStatus?.status === "Open";
  const headIsInitializing = headStatus?.status === "Initializing";

  // ── Commit to Head (classic commit while Head is Initializing) ─────────────
  async function handleCommit() {
    if (!address || !selected) return;
    setCommitting(true); setError(null);
    try {
      const { unsignedTxCbor, txId: ctxId } = await api.cropBuildCommitTx({
        address, assetNameHex: selected.assetNameHex,
      });
      // Operator already signed their portion; farmer adds their witness (partialSign=true)
      const signedCbor = await signTx(unsignedTxCbor, true);
      await api.cropSubmitCommitTx({ signedTxCbor: signedCbor });
      setCommitDone(ctxId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al commitear");
    } finally {
      setCommitting(false);
    }
  }

  // ── Collect (open the Head) ────────────────────────────────────────────────
  async function handleCollect() {
    setCollecting(true); setError(null);
    try {
      await fetch("/api/head/collect", { method: "POST" }).then(async (r) => {
        if (!r.ok) {
          const d = await r.json() as { error?: string };
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
      });
      // Poll until head is Open
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const hs = await api.headStatus();
        setHeadStatus(hs);
        if (hs.status === "Open") break;
      }
      if (address) await loadTokens(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al abrir el Head");
    } finally {
      setCollecting(false);
    }
  }

  // ── Split ADA (prepare collateral + buyer-input UTxOs) ────────────────────
  async function handleSplitAda() {
    setError(null);
    try {
      await fetch("/api/head/split-ada", { method: "POST" }).then(async (r) => {
        if (!r.ok) {
          const d = await r.json() as { error?: string };
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
      });
      setSuccess("✓ ADA dividida. Hay 2 UTxOs ADA disponibles para compras.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al dividir ADA");
    }
  }

  // ── Create listing (step 1) ────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!address)  { setError("Conectá tu billetera primero"); return; }
    if (!selected) { setError("Seleccioná un token"); return; }
    if (!selected.inHead) { setError("El token debe estar en el Head. Hacé el commit primero."); return; }
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) { setError("Ingresá la cantidad"); return; }
    if (qty > selected.quantity) { setError(`Solo tenés ${selected.quantity} unidades disponibles`); return; }
    const pl = Math.round(parseFloat(priceAda) * 1_000_000);
    if (isNaN(pl) || pl < 2_000_000) { setError("El precio mínimo es 2 ADA"); return; }

    setLoading(true);
    try {
      const result = await api.createListing({
        requestId:     newRequestId(),
        sellerAddress: address,
        policyId:      selected.policyId,
        assetName:     selected.assetNameHex,
        priceLovelace: String(pl),
      });
      setListingId(result.listingId);
      setEscrowTxCbor(result.escrowTxCbor);
      setTxId(result.txId);
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
      const signedCbor = await signTx(escrowTxCbor);
      await api.escrowConfirm(listingId, { signedTxCbor: signedCbor, txId });
      setSuccess("✓ Listing activo. Redirigiendo…");
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
        ✓ Borrador creado. Firmá la tx de escrow con tu billetera para activarlo.
      </div>
      <div>
        <p className="text-sm text-gray-400 mb-1">TX CBOR sin firmar</p>
        <textarea readOnly value={escrowTxCbor} rows={3}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-mono text-gray-400 resize-none" />
        <p className="mt-1 text-xs text-gray-500">TX ID: {txId}</p>
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
          Verificando FarmerPass…
        </div>
      )}
      {address && farmer !== "loading" && !farmerApproved && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-3 text-sm text-red-300">
          ⚠ Solo agricultores aprobados pueden publicar cultivos.{" "}
          {farmer?.status === "pending"
            ? "Tu solicitud de KYC está en revisión."
            : <><a href="/identity" className="underline hover:text-red-200">Completá tu identidad</a> para solicitar acceso.</>}
        </div>
      )}

      {/* Head status indicator */}
      {headStatus && (
        <div className={`rounded-lg border p-3 text-sm flex items-center justify-between ${
          headIsOpen
            ? "border-green-800 bg-green-950 text-green-300"
            : headIsInitializing
            ? "border-blue-800 bg-blue-950 text-blue-300"
            : "border-gray-700 bg-gray-800 text-gray-400"
        }`}>
          <span>Hydra Head: <strong>{headStatus.status}</strong></span>
          <button type="button" onClick={loadHeadStatus} className="text-xs opacity-70 hover:opacity-100">↺</button>
        </div>
      )}

      {/* Token picker */}
      {farmerApproved && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Tus CropTokens</label>
            {address && (
              <button type="button" onClick={() => { void loadTokens(address); void loadHeadStatus(); }}
                className="text-xs text-hydra-400 hover:text-hydra-300">
                ↺ Actualizar
              </button>
            )}
          </div>

          {tokens === "loading" && (
            <p className="text-sm text-gray-500">Consultando billetera y Head…</p>
          )}

          {tokens !== "loading" && tokens !== null && tokens.length === 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-400 text-center">
              No tenés CropTokens en tu billetera L1.{" "}
              <a href="/identity" className="underline text-hydra-400 hover:text-hydra-300">
                Mintealos en Identidad
              </a>.
            </div>
          )}

          {tokens !== "loading" && tokens !== null && tokens.length > 0 && (
            <div className="grid gap-2">
              {tokens.map((t) => (
                <button
                  key={t.assetNameHex}
                  type="button"
                  onClick={() => { setSelected(t); setQuantity(String(t.quantity)); setError(null); setCommitDone(null); }}
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
                      t.inHead
                        ? "bg-green-900 text-green-300"
                        : "bg-yellow-900 text-yellow-300"
                    }`}>
                      {t.inHead ? "En el Head ✓" : "L1 — necesita commit"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Commit to Head panel (classic commit — Head must be Initializing) */}
      {selected && !selected.inHead && !commitDone && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-4 space-y-3">
          <p className="text-sm text-yellow-200 font-medium">Paso previo: Commit al Head de Hydra</p>
          {!headIsInitializing && !headIsOpen && (
            <p className="text-xs text-yellow-400">
              El Head debe estar en estado <strong>Initializing</strong> para hacer el commit clásico.
              Estado actual: <strong>{headStatus?.status ?? "desconocido"}</strong>.
            </p>
          )}
          {headIsInitializing && (
            <p className="text-xs text-yellow-400">
              El Head está listo para el commit. Tu token + el ADA del operador se comprometerán juntos.
              Firmá la tx con tu billetera.
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleCommit}
            disabled={committing || !headIsInitializing}
            className="w-full rounded-lg bg-yellow-700 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-50"
          >
            {committing ? "Firmando commit…" : "Commit al Head (firma requerida)"}
          </button>
        </div>
      )}

      {/* After commit: show Collect button to open the Head */}
      {commitDone && !selected?.inHead && (
        <div className="rounded-lg border border-blue-800 bg-blue-950 p-4 space-y-3">
          <p className="text-sm text-blue-300 font-medium">
            ✓ Commit enviado ({commitDone.slice(0, 12)}…)
          </p>
          {!headIsOpen && (
            <>
              <p className="text-xs text-blue-400">
                Ahora el operador puede abrir el Head. Hacé clic en <strong>Abrir Head</strong>.
              </p>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="button"
                onClick={handleCollect}
                disabled={collecting}
                className="w-full rounded-lg bg-blue-700 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {collecting ? "Abriendo Head… (puede tardar ~30s)" : "Abrir Head (Collect)"}
              </button>
            </>
          )}
          {headIsOpen && (
            <p className="text-xs text-green-300">
              ✓ Head abierto. Presioná <strong>Actualizar</strong> para ver tu token en el Head.
            </p>
          )}
        </div>
      )}

      {/* Split ADA helper (only shown when Head is open and no commit pending) */}
      {headIsOpen && !commitDone && (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-400 flex items-center justify-between">
          <span>Preparar UTxOs para compras (dividir ADA del operador)</span>
          <button type="button" onClick={handleSplitAda}
            className="text-xs text-hydra-400 hover:text-hydra-300 ml-3">
            Dividir ADA
          </button>
        </div>
      )}

      {/* Quantity + price */}
      {selected?.inHead && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Cantidad a vender <span className="text-gray-600">(máx {selected.quantity})</span>
            </label>
            <input
              type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ej: 500" min="1" max={selected.quantity} step="1"
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
            <p className="mt-1 text-xs text-gray-600">Lo que recibirás al vender</p>
          </div>
        </div>
      )}

      {error && !committing && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}

      <button
        type="submit"
        disabled={loading || !address || !farmerApproved || !selected || !selected.inHead || !headIsOpen}
        className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50"
      >
        {loading ? "Creando…"
          : !selected ? "Seleccioná un token"
          : !selected.inHead ? "Commit al Head primero"
          : !headIsOpen ? "Head no está abierto"
          : `Publicar ${selected.assetName}`}
      </button>
    </form>
  );
}
