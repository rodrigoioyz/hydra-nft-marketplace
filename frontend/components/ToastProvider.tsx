"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useWallet } from "@/context/WalletContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type ToastKind = "success" | "error" | "info" | "warning";

interface Toast {
  id:      number;
  kind:    ToastKind;
  title:   string;
  body?:   string;
}

interface ToastContextValue {
  addToast: (kind: ToastKind, title: string, body?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ── Toast UI ──────────────────────────────────────────────────────────────────

const KIND_STYLES: Record<ToastKind, { border: string; icon: string }> = {
  success: { border: "border-green-700 bg-gray-900",  icon: "✓" },
  error:   { border: "border-red-700 bg-gray-900",    icon: "✗" },
  info:    { border: "border-hydra-700 bg-gray-900",  icon: "ℹ" },
  warning: { border: "border-yellow-700 bg-gray-900", icon: "⚠" },
};

const KIND_TEXT: Record<ToastKind, string> = {
  success: "text-green-400",
  error:   "text-red-400",
  info:    "text-hydra-400",
  warning: "text-yellow-400",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const s = KIND_STYLES[toast.kind];
  const t = KIND_TEXT[toast.kind];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border ${s.border} px-4 py-3 shadow-lg w-80 animate-fade-in`}
      role="alert"
    >
      <span className={`mt-0.5 text-sm font-bold ${t}`}>{s.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${t}`}>{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-xs text-gray-400">{toast.body}</p>}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-1 text-gray-600 hover:text-gray-400 text-xs"
        aria-label="Cerrar"
      >
        ✕
      </button>
    </div>
  );
}

// ── SSE event labels ──────────────────────────────────────────────────────────

function toastFromSseEvent(
  msg: { type: string; walletAddress?: string },
  myAddress: string | null
): { kind: ToastKind; title: string; body?: string } | null {
  if (msg.type === "CommitFinalized") {
    return { kind: "success", title: "Token disponible", body: "Tu depósito fue procesado. Ya podés publicarlo en venta." };
  }
  if (msg.type === "DecommitFinalized") {
    return { kind: "success", title: "Retiro completado", body: "Tu UTxO fue devuelto a tu billetera." };
  }
  if (msg.type === "FarmerApproved" && msg.walletAddress === myAddress) {
    return { kind: "success", title: "FarmerPass activado", body: "Tu registro fue aprobado. Ya podés listar cultivos." };
  }
  if (msg.type === "HeadIsClosed") {
    return { kind: "warning", title: "Marketplace cerrado temporalmente", body: "Las operaciones reanudarán pronto." };
  }
  if (msg.type === "HeadIsOpen") {
    return { kind: "info", title: "Marketplace abierto", body: "Ya podés comprar y vender." };
  }
  if (msg.type === "hydra:disconnected") {
    return { kind: "error", title: "Conexión perdida", body: "Reconectando al marketplace…" };
  }
  if (msg.type === "hydra:connected") {
    return { kind: "info", title: "Conectado al marketplace" };
  }
  return null;
}

// ── Provider ──────────────────────────────────────────────────────────────────

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { address } = useWallet();
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, title, body }]);
    const t = setTimeout(() => dismiss(id), 5000);
    timers.current.set(id, t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss(id: number) {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // SSE subscription — listens to /api/events and converts Hydra events to toasts
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as {
          type: string;
          walletAddress?: string;
        };
        const toast = toastFromSseEvent(msg, address ?? null);
        if (toast) addToast(toast.kind, toast.title, toast.body);
      } catch { /* ignore malformed */ }
    });
    return () => es.close();
  }, [address, addToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Fixed toast stack — bottom-right */}
      <div
        aria-live="polite"
        className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
