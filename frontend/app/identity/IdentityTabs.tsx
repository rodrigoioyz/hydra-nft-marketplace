"use client";

import { useState } from "react";
import { KycForm } from "./KycForm";
import { CropMintForm } from "./CropMintForm";

const TABS = [
  { id: "kyc",   label: "Mi Identidad" },
  { id: "crops", label: "Mis Cultivos" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function IdentityTabs() {
  const [active, setActive] = useState<TabId>("kyc");

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 flex border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active === tab.id
                ? "border-hydra-500 text-hydra-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === "kyc"   && <KycForm />}
      {active === "crops" && <CropMintForm />}
    </div>
  );
}
