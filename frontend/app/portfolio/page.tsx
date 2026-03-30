"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/context/WalletContext";
import { api, lovelaceToAda, type WalletBalance } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToName(hex: string): string {
  try {
    const s = Buffer.from(hex, "hex").toString("utf8");
    return /[\x00-\x08\x0e-\x1f\x7f]/.test(s) ? hex.slice(0, 16) + "…" : (s || hex);
  } catch { return hex; }
}

// Parse "policyId.assetNameHex" unit into readable name
function unitToName(unit: string): string {
  const dot = unit.lastIndexOf(".");
  if (dot === -1) return unit.slice(0, 16) + "…";
  return hexToName(unit.slice(dot + 1));
}

// ── Deposit button ─────────────────────────────────────────────────────────────

type DepositStatus = "idle" | "building" | "signing" | "submitting" | "pending" | "error";

function DepositButton({
  utxo,
  address,
  onPending,
}: {
  utxo:      WalletBalance["utxos"][number];
  address:   string;
  onPending: (ref: string) => void;
}) {
  const { signTx } = useWallet();
  const [status, setStatus] = useState<DepositStatus>("idle");
  const [error,  setError]  = useState<string | null>(null);

  const LABEL: Record<DepositStatus, string> = {
    idle:       "Depositar al marketplace",
    building:   "Preparando…",
    signing:    "Esperando firma…",
    submitting: "Enviando a L1…",
    pending:    "En tránsito ↗",
    error:      "Reintentar",
  };

  async function handleDeposit() {
    setError(null);
    try {
      // 1. Build commit tx
      setStatus("building");
      const { commitTxCbor } = await api.deposit({
        address,
        utxoRef:  utxo.ref,
        lovelace: utxo.lovelace,
        assets:   Object.keys(utxo.assets).length > 0
          ? buildAssetsSpec(utxo.assets)
          : undefined,
      });

      // 2. User signs
      setStatus("signing");
      const signedCbor = await signTx(commitTxCbor, false);

      // 3. Submit to L1
      setStatus("submitting");
      await api.submitL1Tx(signedCbor);

      // 4. Mark as pending — waiting for CommitRecorded
      setStatus("pending");
      onPending(utxo.ref);
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  const busy = status === "building" || status === "signing" || status === "submitting";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => void handleDeposit()}
        disabled={busy || status === "pending"}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
          status === "pending"
            ? "bg-yellow-950 text-yellow-400 border border-yellow-800 cursor-default"
            : status === "error"
              ? "bg-red-900 text-red-300 hover:bg-red-800 border border-red-700"
              : "bg-hydra-600 text-white hover:bg-hydra-500 disabled:opacity-50"
        }`}
      >
        {busy && <span className="mr-1 inline-block animate-spin">⟳</span>}
        {LABEL[status]}
      </button>
      {error && <p className="text-xs text-red-400 max-w-[180px] text-right">{error}</p>}
    </div>
  );
}

// Convert flat assets record (unit → quantity) to nested (policyId → assetName → qty)
function buildAssetsSpec(
  assets: Record<string, string | number>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [unit, qty] of Object.entries(assets)) {
    const dot = unit.lastIndexOf(".");
    if (dot === -1) continue; // skip "lovelace"
    const policyId  = unit.slice(0, dot);
    const assetName = unit.slice(dot + 1);
    out[policyId] ??= {};
    out[policyId][assetName] = Number(qty);
  }
  return out;
}

// ── Withdraw button ────────────────────────────────────────────────────────────

function WithdrawButton({ utxoRef }: { utxoRef: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error,  setError]  = useState<string | null>(null);

  async function handleWithdraw() {
    setError(null);
    setStatus("loading");
    try {
      await api.withdraw(utxoRef);
      setStatus("done");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  if (status === "done") {
    return <span className="text-xs text-yellow-400">Retiro solicitado ↙</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => void handleWithdraw()}
        disabled={status === "loading"}
        className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700 disabled:opacity-50"
      >
        {status === "loading" ? "Solicitando…" : status === "error" ? "Reintentar" : "Retirar"}
      </button>
      {error && <p className="text-xs text-red-400 max-w-[180px] text-right">{error}</p>}
    </div>
  );
}

// ── UTxO tables ────────────────────────────────────────────────────────────────

function L1UtxoTable({
  utxos,
  address,
  pendingRefs,
  onPending,
}: {
  utxos:       WalletBalance["utxos"];
  address:     string;
  pendingRefs: Set<string>;
  onPending:   (ref: string) => void;
}) {
  if (utxos.length === 0) return <p className="text-sm text-gray-500">Sin fondos en cadena</p>;

  return (
    <div className="space-y-2">
      {utxos.map((u) => {
        const hasTokens   = Object.keys(u.assets).length > 0;
        const isPending   = pendingRefs.has(u.ref);
        return (
          <div
            key={u.ref}
            className={`flex items-center justify-between rounded-lg border p-3 ${
              isPending ? "border-yellow-800 bg-yellow-950/20" : "border-gray-800 bg-gray-800/40"
            }`}
          >
            <div className="min-w-0">
              <p className="text-xs font-mono text-gray-400">
                {u.ref.slice(0, 12)}…#{u.ref.split("#")[1]}
              </p>
              <p className="mt-0.5 text-sm text-white">{lovelaceToAda(u.lovelace)} ₳</p>
              {hasTokens && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(u.assets).map(([unit, qty]) => (
                    <span key={unit} className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
                      {unitToName(unit)}: {qty}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ml-3 shrink-0">
              {isPending ? (
                <span className="text-xs text-yellow-400 flex items-center gap-1">
                  <span className="inline-block animate-spin">⟳</span> En tránsito
                </span>
              ) : hasTokens ? (
                <DepositButton utxo={u} address={address} onPending={onPending} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HeadUtxoTable({ utxos }: { utxos: WalletBalance["utxos"] }) {
  if (utxos.length === 0) return <p className="text-sm text-gray-500">Sin fondos en el marketplace</p>;

  return (
    <div className="space-y-2">
      {utxos.map((u) => {
        const hasTokens = Object.keys(u.assets).length > 0;
        return (
          <div
            key={u.ref}
            className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/40 p-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-mono text-gray-400">
                {u.ref.slice(0, 12)}…#{u.ref.split("#")[1]}
              </p>
              <p className="mt-0.5 text-sm text-white">{lovelaceToAda(u.lovelace)} ₳</p>
              {hasTokens && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(u.assets).map(([unit, qty]) => (
                    <span key={unit} className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
                      {unitToName(unit)}: {qty}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ml-3 shrink-0">
              <WithdrawButton utxoRef={u.ref} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { address } = useWallet();
  const [l1,       setL1]      = useState<WalletBalance | null>(null);
  const [head,     setHead]    = useState<WalletBalance | null>(null);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState<string | null>(null);
  // Track UTxO refs submitted to L1 but not yet in Head
  const [pending,  setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [l1Res, headRes] = await Promise.all([
        api.walletL1Balance(address),
        api.walletHeadBalance(address),
      ]);
      setL1(l1Res);
      setHead(headRes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void load(); }, [load]);

  // SSE: remove from pending when CommitRecorded arrives; refresh on decommit finalized
  useEffect(() => {
    if (!address) return;
    const es = new EventSource("/api/events");
    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string };
        if (msg.type === "CommitRecorded" || msg.type === "CommitFinalized") {
          // Refresh to show new Head balance and clear pending state
          void load();
          setPending(new Set());
        }
        if (msg.type === "DecommitFinalized" || msg.type === "SnapshotConfirmed") {
          void load();
        }
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, [address, load]);

  const addPending = useCallback((ref: string) => {
    setPending((prev) => new Set([...prev, ref]));
  }, []);

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-4xl">👛</p>
        <p className="mt-4 text-lg font-semibold text-white">Conecta tu billetera</p>
        <p className="mt-1 text-sm text-gray-400">
          Para ver tu portfolio necesitás conectar una billetera Cardano.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Mi Portfolio</h1>
          <p className="mt-1 text-sm font-mono text-gray-500">
            {address.slice(0, 20)}…{address.slice(-8)}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
        >
          {loading ? "Cargando…" : "↺ Actualizar"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
          Error: {error}
        </div>
      )}

      {!loading && l1 && head && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Balance en cadena (L1)</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {lovelaceToAda(l1.totalLovelace)} ₳
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {l1.utxos.length} UTxO{l1.utxos.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="rounded-xl border border-hydra-800 bg-gray-900 p-5">
              <p className="text-xs text-hydra-400 uppercase tracking-wide">En el marketplace</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {lovelaceToAda(head.totalLovelace)} ₳
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {head.utxos.length} UTxO{head.utxos.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Pending deposits banner */}
          {pending.size > 0 && (
            <div className="rounded-xl border border-yellow-800 bg-yellow-950/30 p-4">
              <p className="text-sm text-yellow-300">
                <span className="mr-2 inline-block animate-spin">⟳</span>
                {pending.size} depósito{pending.size > 1 ? "s" : ""} en tránsito hacia el marketplace.
                Aparecerá{pending.size > 1 ? "n" : ""} automáticamente cuando se confirme{pending.size > 1 ? "n" : ""}.
              </p>
            </div>
          )}

          {/* L1 UTxOs */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                Fondos en cadena
              </h2>
              <p className="text-xs text-gray-500">
                Los tokens con botón "Depositar" pueden enviarse al marketplace
              </p>
            </div>
            <L1UtxoTable
              utxos={l1.utxos}
              address={address}
              pendingRefs={pending}
              onPending={addPending}
            />
          </div>

          {/* Head UTxOs */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                Fondos en el marketplace
              </h2>
              <p className="text-xs text-gray-500">
                Podés retirar cualquier UTxO de vuelta a cadena
              </p>
            </div>
            <HeadUtxoTable utxos={head.utxos} />
          </div>
        </>
      )}
    </div>
  );
}
