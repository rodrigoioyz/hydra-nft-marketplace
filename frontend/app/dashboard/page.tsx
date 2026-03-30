"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { api, lovelaceToAda, type FarmerStats, type FarmerRegistration, type EscrowInfo } from "@/lib/api";

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

// ── Marketplace status badge ──────────────────────────────────────────────────

function MarketplaceBadge() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.headStatus()
      .then((s) => setStatus(s.status.toLowerCase()))
      .catch(() => setStatus("unknown"));
  }, []);

  const isOpen = status === "open";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        isOpen
          ? "bg-green-950 text-green-400 border border-green-800"
          : "bg-gray-800 text-gray-400 border border-gray-700"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-green-400" : "bg-gray-500"}`} />
      Marketplace {isOpen ? "abierto" : status ?? "…"}
    </span>
  );
}

// ── Recent sale row ───────────────────────────────────────────────────────────

function hexToName(hex: string): string {
  try {
    return Buffer.from(hex, "hex").toString("utf8") || hex;
  } catch {
    return hex;
  }
}

function RecentSaleRow({ sale }: { sale: FarmerStats["recentSales"][number] }) {
  const name = hexToName(sale.assetName);
  const ada  = lovelaceToAda(sale.priceLovelace);
  const date = sale.confirmedAt ? new Date(sale.confirmedAt).toLocaleDateString("es-AR") : "—";
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div>
        <p className="text-sm text-white">{name}</p>
        <p className="text-xs text-gray-500">{date}</p>
      </div>
      <p className="text-sm font-semibold text-green-400">+{ada} ₳</p>
    </div>
  );
}

// ── Active listing row ────────────────────────────────────────────────────────

function ActiveListingRow({ escrow }: { escrow: EscrowInfo }) {
  const name = escrow.displayName ?? hexToName(escrow.assetName);
  const ada  = lovelaceToAda(escrow.priceLovelace);
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div>
        <p className="text-sm text-white">{name}</p>
        <p className="text-xs text-gray-500">
          {escrow.inHead ? (
            <span className="text-green-400">Disponible ✓</span>
          ) : (
            <span className="text-yellow-400">Pendiente de habilitación</span>
          )}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-white">{ada} ₳</p>
        <Link href={`/listings/${escrow.id}`} className="text-xs text-hydra-400 hover:underline">
          Ver listado
        </Link>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { address } = useWallet();

  const [stats,    setStats]    = useState<FarmerStats | null>(null);
  const [farmer,   setFarmer]   = useState<FarmerRegistration | null>(null);
  const [escrows,  setEscrows]  = useState<EscrowInfo[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, farmerRes, escrowsRes] = await Promise.allSettled([
        api.farmerStats(address),
        api.farmerStatus(address),
        api.myEscrows(address),
      ]);
      if (statsRes.status   === "fulfilled") setStats(statsRes.value);
      if (farmerRes.status  === "fulfilled") setFarmer(farmerRes.value);
      if (escrowsRes.status === "fulfilled") setEscrows(escrowsRes.value.escrows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void load(); }, [load]);

  // SSE: refresh stats on confirmed sales
  useEffect(() => {
    if (!address) return;
    const es = new EventSource("/api/events");
    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string };
        if (msg.type === "SnapshotConfirmed" || msg.type === "TxValid") void load();
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, [address, load]);

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-4xl">🌾</p>
        <p className="mt-4 text-lg font-semibold text-white">Conecta tu billetera</p>
        <p className="mt-1 text-sm text-gray-400">
          Para ver tu dashboard necesitás conectar una billetera Cardano.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Dashboard{farmer?.companyName ? ` — ${farmer.companyName}` : ""}
          </h1>
          <p className="mt-1 text-sm font-mono text-gray-500">
            {address.slice(0, 20)}…{address.slice(-8)}
          </p>
        </div>
        <MarketplaceBadge />
      </div>

      {loading && <p className="text-sm text-gray-400">Cargando…</p>}
      {error   && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
          Error: {error}
        </div>
      )}

      {/* KYC status banner */}
      {farmer && farmer.status !== "approved" && (
        <div className="rounded-xl border border-yellow-800 bg-yellow-950 p-4">
          <p className="text-sm text-yellow-300">
            {farmer.status === "pending"
              ? "Tu registro está en revisión. Podrás listar cultivos una vez aprobado."
              : "Tu registro fue rechazado. "}
            {farmer.status === "rejected" && (
              <Link href="/identity" className="underline">Volver a intentar</Link>
            )}
          </p>
        </div>
      )}

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Activos en venta"
            value={stats.activeListings}
          />
          <StatCard
            label="Total publicados"
            value={stats.totalListed}
          />
          <StatCard
            label="Ventas cerradas"
            value={stats.totalSold}
          />
          <StatCard
            label="Ingresos totales"
            value={`${lovelaceToAda(stats.totalRevenueLovelace)} ₳`}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active listings */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
              Publicaciones activas
            </h2>
            <Link href="/sell" className="text-xs text-hydra-400 hover:underline">
              + Publicar
            </Link>
          </div>
          {escrows.length === 0 ? (
            <p className="text-sm text-gray-500">
              No tenés cultivos en venta.{" "}
              <Link href="/sell" className="text-hydra-400 hover:underline">
                Publicar ahora
              </Link>
            </p>
          ) : (
            <div>
              {escrows.map((e) => (
                <ActiveListingRow key={e.id} escrow={e} />
              ))}
            </div>
          )}
        </div>

        {/* Recent sales */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Últimas ventas
          </h2>
          {!stats || stats.recentSales.length === 0 ? (
            <p className="text-sm text-gray-500">Aún no hay ventas registradas.</p>
          ) : (
            <div>
              {stats.recentSales.map((s) => (
                <RecentSaleRow key={s.listingId} sale={s} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/sell"
          className="rounded-lg bg-hydra-600 px-4 py-2 text-sm font-semibold text-white hover:bg-hydra-500"
        >
          Publicar cultivo
        </Link>
        <Link
          href="/portfolio"
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
        >
          Ver portfolio
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
        >
          Explorar marketplace
        </Link>
      </div>
    </div>
  );
}
