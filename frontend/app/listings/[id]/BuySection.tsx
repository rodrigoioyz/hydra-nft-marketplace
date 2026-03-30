"use client";

import { useState } from "react";
import { api, newRequestId, lovelaceToAda } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";

interface Props { listingId: string; priceLovelace: string; displayName?: string | null; }

type Step = "idle" | "procesando" | "confirmado" | "error";

export function BuySection({ listingId, priceLovelace, displayName }: Props) {
  const { address } = useWallet();
  const [open,   setOpen]   = useState(false);
  const [step,   setStep]   = useState<Step>("idle");
  const [txId,   setTxId]   = useState<string | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  function openModal() { setOpen(true); setStep("idle"); setError(null); setTxId(null); }
  function closeModal() { setOpen(false); setStep("idle"); setError(null); }

  async function handleBuy() {
    if (!address) { setError("Conectá tu billetera primero"); return; }
    setStep("procesando"); setError(null);
    try {
      const result = await api.buy(listingId, { requestId: newRequestId(), buyerAddress: address });
      setTxId(result.hydraTxId ?? null);
      setStep("confirmado");
      setTimeout(() => { setOpen(false); window.location.reload(); }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al procesar la compra");
      setStep("error");
    }
  }

  const itemName = displayName ?? "este artículo";

  return (
    <>
      <button onClick={openModal}
        className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 transition-colors">
        Comprar por {lovelaceToAda(priceLovelace)} ADA
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-4">

            {step === "idle" && (
              <>
                <h2 className="text-lg font-bold text-white">Confirmar compra</h2>
                <p className="text-sm text-gray-400">
                  Vas a comprar <strong className="text-white">{itemName}</strong> por{" "}
                  <strong className="text-white">{lovelaceToAda(priceLovelace)} ADA</strong>.
                  La operación es instantánea.
                </p>
                {!address
                  ? <p className="text-sm text-yellow-400">⚠ Conectá tu billetera (arriba a la derecha) para continuar.</p>
                  : <p className="text-xs text-gray-500 font-mono break-all">Destino: {address.slice(0, 20)}…{address.slice(-8)}</p>
                }
                <div className="flex gap-3 pt-1">
                  <button onClick={closeModal}
                    className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Cancelar
                  </button>
                  <button onClick={handleBuy} disabled={!address}
                    className="flex-1 rounded-lg bg-hydra-600 py-2 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50">
                    Confirmar compra
                  </button>
                </div>
              </>
            )}

            {step === "procesando" && (
              <>
                <h2 className="text-lg font-bold text-white">Procesando…</h2>
                <div className="space-y-2">
                  {[
                    "Verificando disponibilidad",
                    "Ejecutando transferencia",
                    "Registrando en el marketplace",
                  ].map((msg, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="animate-spin text-hydra-400">⟳</span>
                      {msg}…
                    </div>
                  ))}
                </div>
              </>
            )}

            {step === "confirmado" && (
              <>
                <div className="text-center space-y-2">
                  <p className="text-4xl">✅</p>
                  <h2 className="text-lg font-bold text-white">Compra exitosa</h2>
                  <p className="text-sm text-gray-400">
                    <strong className="text-white">{itemName}</strong> fue transferido a tu billetera.
                  </p>
                  {txId && (
                    <p className="text-xs text-gray-500 font-mono break-all">
                      ID de operación: {txId.slice(0, 20)}…{txId.slice(-8)}
                    </p>
                  )}
                  <p className="text-xs text-gray-600">Cerrando automáticamente…</p>
                </div>
              </>
            )}

            {step === "error" && (
              <>
                <h2 className="text-lg font-bold text-white">Algo salió mal</h2>
                <p className="text-sm text-red-400">{error}</p>
                <div className="flex gap-3">
                  <button onClick={closeModal}
                    className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Cerrar
                  </button>
                  <button onClick={() => { setStep("idle"); setError(null); }}
                    className="flex-1 rounded-lg bg-hydra-600 py-2 text-sm font-semibold text-white hover:bg-hydra-500">
                    Reintentar
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
