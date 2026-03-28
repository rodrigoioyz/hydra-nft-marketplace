import { AdminPanel } from "./AdminPanel";

export const metadata = { title: "Admin · Hydra Marketplace" };

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold text-white">Panel de Operador</h1>
      <p className="mb-6 text-sm text-gray-400">
        Revisá y aprobá las solicitudes de FarmerPass. Minteá el NFT en L1 antes de aprobar.
      </p>
      <AdminPanel />
    </div>
  );
}
