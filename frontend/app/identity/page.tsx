import { IdentityTabs } from "./IdentityTabs";

export const metadata = { title: "Mi Identidad · Hydra Marketplace" };

export default function IdentityPage() {
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold text-white">Mi Identidad de Productor</h1>
      <p className="mb-6 text-sm text-gray-400">
        Registrate como productor para poder mintear y vender tus cultivos en el marketplace.
      </p>
      <IdentityTabs />
    </div>
  );
}
