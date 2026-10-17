"use client";

import { useState, type ReactNode } from "react";
import { MonthlyLaborCostsWorkspace } from "@/components/monthly-labor-costs-workspace";

export function HeuresTabs({ hours }: { hours: ReactNode }) {
  const [tab, setTab] = useState<"actual" | "monthly">("actual");

  return (
    <div className="papotHeuresTabs">
      <nav className="heuresTabsBar" aria-label="Onglets de gestion des heures">
        <button
          type="button"
          aria-current={tab === "actual" ? "page" : undefined}
          className={tab === "actual" ? "isSelected" : ""}
          onClick={() => setTab("actual")}
        >
          Saisie des heures
        </button>
        <button
          type="button"
          aria-current={tab === "monthly" ? "page" : undefined}
          className={tab === "monthly" ? "isSelected" : ""}
          onClick={() => setTab("monthly")}
        >
          Coûts mensuels
        </button>
      </nav>
      {tab === "actual" ? hours : <MonthlyLaborCostsWorkspace />}
      <style jsx global>{`
        .papotHeuresTabs {
          display: grid;
          gap: 20px;
        }
        .heuresTabsBar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          border-bottom: 1px solid #ddd3e9;
          padding-bottom: 9px;
        }
        .heuresTabsBar button {
          cursor: pointer;
          padding: 10px 17px;
          background: #f6f2fc;
          color: #5c4c7f;
          border: 1px solid #e3d8f0;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 750;
        }
        .heuresTabsBar button.isSelected {
          background: #665097;
          color: white;
          border-color: #665097;
        }
        .heuresTabsBar button:focus-visible {
          outline: 3px solid #bba8e4;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
