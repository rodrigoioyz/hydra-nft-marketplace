"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/context/WalletContext";

const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY ?? "";

interface PendingFarmer {
  id:           string;
  walletAddress: string;
  companyName:  string;
  identityHash: string;
  createdAt:    string;
}

async function adminPost(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

async function adminGet(path: string) {
  const res = await fetch(`/api${path}`, { headers: { "X-Admin-Key": ADMIN_KEY }, cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 12)}…${addr.slice(-6)}`;
}

export function AdminPanel() {
  const { address } = useWallet();
  const [farmers,       setFarmers]       = useState<PendingFarmer[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [actionId,      setActionId]      = useState<string | null>(null);
  const [passTxHash,    setPassTxHash]    = useState<Record<string, string>>({});
  const [rejectReason,  setRejectReason]  = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await adminGet("/admin/farmers/pending");
      setFarmers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando solicitudes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleApprove(id: string) {
    if (!address) { setError("Conectá tu billetera"); return; }
    const txHash = passTxHash[id]?.trim();
    if (!txHash) { setError(`Ingresá el TX hash del FarmerPass para ${id}`); return; }
    setActionId(id); setError(null);
    try {
      await adminPost(`/admin/farmers/${id}/approve`, { reviewerAddress: address, farmerPassTxHash: txHash });
      setFarmers((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al aprobar");
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string) {
    if (!address) { setError("Conectá tu billetera"); return; }
    const reason = rejectReason[id]?.trim();
    if (!reason) { setError(`Ingresá el motivo de rechazo para ${id}`); return; }
    setActionId(id); setError(null);
    try {
      await adminPost(`/admin/farmers/${id}/reject`, { reviewerAddress: address, reason });
      setFarmers((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al rechazar");
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Solicitudes pendientes{farmers.length > 0 && ` (${farmers.length})`}
        </h2>
        <button
          onClick={refresh} disabled={loading}
          className="text-sm text-hydra-400 hover:text-hydra-300 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "↺ Actualizar"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && farmers.length === 0 && (
        <p className="text-sm text-gray-500">No hay solicitudes pendientes.</p>
      )}

      {farmers.map((f) => (
        <div key={f.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-gray-500">Empresa</p>
              <p className="text-white font-medium">{f.companyName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Wallet</p>
              <p className="font-mono text-gray-300 text-xs">{shortAddr(f.walletAddress)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Hash identidad (sha256)</p>
              <p className="font-mono text-xs text-gray-500 break-all">{f.identityHash}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Solicitado</p>
              <p className="text-xs text-gray-400">{new Date(f.createdAt).toLocaleString()}</p>
            </div>
          </div>

          {/* Approve */}
          <div className="space-y-2">
            <label className="block text-xs text-gray-400">TX hash del FarmerPass minted en L1</label>
            <input
              type="text"
              value={passTxHash[f.id] ?? ""}
              onChange={(e) => setPassTxHash((p) => ({ ...p, [f.id]: e.target.value }))}
              placeholder="abc123def456…"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-mono text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
            />
            <button
              onClick={() => handleApprove(f.id)}
              disabled={actionId === f.id}
              className="w-full rounded-lg bg-green-700 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
            >
              {actionId === f.id ? "Procesando…" : "Aprobar"}
            </button>
          </div>

          {/* Reject */}
          <div className="space-y-2">
            <label className="block text-xs text-gray-400">Motivo de rechazo</label>
            <input
              type="text"
              value={rejectReason[f.id] ?? ""}
              onChange={(e) => setRejectReason((p) => ({ ...p, [f.id]: e.target.value }))}
              placeholder="Ej: Documentación inválida"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-red-500 focus:outline-none"
            />
            <button
              onClick={() => handleReject(f.id)}
              disabled={actionId === f.id}
              className="w-full rounded-lg bg-red-900 py-2 text-sm font-semibold text-red-300 hover:bg-red-800 disabled:opacity-50"
            >
              {actionId === f.id ? "Procesando…" : "Rechazar"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
