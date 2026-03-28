import { api } from "@/lib/api";

const headColors: Record<string, string> = {
  Open:          "bg-green-500",
  open:          "bg-green-500",
  Idle:          "bg-gray-500",
  idle:          "bg-gray-500",
  Closed:        "bg-yellow-500",
  closed:        "bg-yellow-500",
  FanoutPossible:"bg-blue-500",
  fanout_pending:"bg-blue-500",
  Final:         "bg-purple-500",
  finalized:     "bg-purple-500",
};

export async function HeadStatusBadge() {
  let headStatus = "Unknown";
  let dbOk  = false;
  let hydraConnected = false;

  try {
    const h = await api.health();
    headStatus     = h.headStatus;
    dbOk           = h.db === "ok";
    hydraConnected = h.hydra === "connected";
  } catch {
    // backend not running — show all red
  }

  const dot = headColors[headStatus] ?? "bg-red-500";

  return (
    <span className="flex items-center gap-3 text-xs text-gray-400">
      <span className="flex items-center gap-1" title={`DB: ${dbOk ? "ok" : "error"}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${dbOk ? "bg-green-500" : "bg-red-500"}`} />
        DB
      </span>
      <span className="flex items-center gap-1" title={`Hydra: ${hydraConnected ? "connected" : "disconnected"}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${hydraConnected ? "bg-green-500" : "bg-red-500"}`} />
        Hydra
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {headStatus}
      </span>
    </span>
  );
}
