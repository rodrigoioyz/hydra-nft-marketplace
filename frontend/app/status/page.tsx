import { api } from "@/lib/api";

export const revalidate = 10;

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const color =
    ok === true  ? "text-green-400" :
    ok === false ? "text-red-400"   :
    "text-gray-300";
  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-2 text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={`font-mono ${color}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">{title}</h2>
      {children}
    </div>
  );
}

export default async function StatusPage() {
  let health = null;
  let headStatus = null;

  try { health     = await api.health(); }     catch { /* offline */ }
  try { headStatus = await api.headStatus(); } catch { /* offline */ }

  const uptimeStr = health
    ? `${Math.floor(health.uptime / 60)}m ${Math.floor(health.uptime % 60)}s`
    : "—";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold text-white">System Status</h1>

      {!health && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
          ⚠ Backend offline — cannot reach API
        </div>
      )}

      <Section title="Backend">
        <Row label="API"      value={health ? "online" : "offline"} ok={!!health} />
        <Row label="Database" value={health?.db ?? "—"}             ok={health?.db === "ok"} />
        <Row label="Uptime"   value={uptimeStr} />
        <Row label="Started"  value={health?.startedAt ?? "—"} />
      </Section>

      <Section title="Hydra Node">
        <Row label="Connection" value={health?.hydra ?? "—"}      ok={health?.hydra === "connected"} />
        <Row label="Head status" value={health?.headStatus ?? "—"} ok={health?.headOpen} />
        <Row label="Opened at"   value={headStatus?.openedAt ?? "—"} />
        <Row label="Session ID"  value={headStatus?.sessionId ?? "—"} />
        {headStatus?.contestationDeadline && (
          <Row label="Contestation deadline" value={headStatus.contestationDeadline} />
        )}
      </Section>
    </div>
  );
}
