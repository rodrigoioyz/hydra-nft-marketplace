"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useWallet } from "@/context/WalletContext";
import type { FarmerRegistration } from "@/lib/api";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:  { label: "En revisión",  color: "text-yellow-400" },
  approved: { label: "Aprobado ✓",  color: "text-green-400"  },
  rejected: { label: "Rechazado",   color: "text-red-400"    },
};

export function KycForm() {
  const { address } = useWallet();

  const [registration, setRegistration] = useState<FarmerRegistration | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [companyName,   setCompanyName]   = useState("");
  const [nombre,        setNombre]        = useState("");
  const [documento,     setDocumento]     = useState("");
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [success,       setSuccess]       = useState<string | null>(null);

  // Fetch existing registration when wallet connects
  useEffect(() => {
    if (!address) { setRegistration(null); return; }
    setLoadingStatus(true);
    api.farmerStatus(address)
      .then(setRegistration)
      .catch(() => setRegistration(null))
      .finally(() => setLoadingStatus(false));
  }, [address]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!address) { setError("Conectá tu billetera primero"); return; }
    if (!companyName.trim()) { setError("Ingresá el nombre de la empresa"); return; }
    if (!nombre.trim() || !documento.trim()) { setError("Ingresá nombre completo y número de documento"); return; }

    setLoading(true);
    try {
      // Hash computed in browser — PII never leaves this device
      const identityHash = await sha256Hex(`${nombre.trim().toLowerCase()}:${documento.trim()}`);
      const reg = await api.farmerRegister({ walletAddress: address, companyName: companyName.trim(), identityHash });
      setRegistration(reg);
      setSuccess("Solicitud enviada. El operador revisará tu registro.");
      setNombre(""); setDocumento("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setLoading(false);
    }
  }

  if (!address) {
    return (
      <div className="rounded-lg border border-yellow-800 bg-yellow-950 p-4 text-sm text-yellow-300">
        ⚠ Conectá tu billetera para registrarte como productor.
      </div>
    );
  }

  if (loadingStatus) {
    return <p className="text-sm text-gray-400">Verificando registro…</p>;
  }

  // Show current status if already registered
  if (registration) {
    const s = STATUS_LABEL[registration.status] ?? { label: registration.status, color: "text-gray-400" };
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Estado de tu registro</span>
            <span className={`text-sm font-semibold ${s.color}`}>{s.label}</span>
          </div>
          <div>
            <p className="text-xs text-gray-500">Empresa</p>
            <p className="text-sm text-white">{registration.companyName}</p>
          </div>
          {registration.farmerPassTxHash && (
            <div>
              <p className="text-xs text-gray-500">FarmerPass TX (L1)</p>
              <p className="text-xs font-mono text-gray-400 break-all">{registration.farmerPassTxHash}</p>
            </div>
          )}
          {registration.status === "pending" && (
            <p className="text-xs text-gray-500">
              Tu solicitud está en revisión. El operador verificará los datos y minteará tu FarmerPass NFT en la blockchain.
            </p>
          )}
          {registration.status === "rejected" && (
            <button
              className="mt-2 text-sm text-hydra-400 underline"
              onClick={() => setRegistration(null)}
            >
              Volver a intentar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-5">
      <p className="text-sm text-gray-400">
        Tu identidad se verifica de forma privada. El nombre y documento <strong className="text-white">nunca salen de tu dispositivo</strong> — solo se guarda una huella digital (hash) en la blockchain.
      </p>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Nombre de la empresa / razón social</label>
        <input
          type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Ej: Agropecuaria Los Pampas S.A."
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-600">Este nombre aparecerá en tus listados (público).</p>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Verificación privada (no se almacena)</p>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Nombre completo del titular</label>
          <input
            type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Juan Pérez"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Número de documento (DNI / CUIT)</label>
          <input
            type="text" value={documento} onChange={(e) => setDocumento(e.target.value)}
            placeholder="Ej: 20-12345678-9"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-hydra-500 focus:outline-none"
          />
        </div>
        <p className="text-xs text-gray-600">
          Se genera un hash SHA-256 de "nombre:documento" en tu navegador. Solo el hash viaja al servidor.
        </p>
      </div>

      {error   && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}

      <button
        type="submit" disabled={loading || !address}
        className="w-full rounded-lg bg-hydra-600 py-3 text-sm font-semibold text-white hover:bg-hydra-500 disabled:opacity-50"
      >
        {loading ? "Enviando…" : "Solicitar FarmerPass"}
      </button>
    </form>
  );
}
