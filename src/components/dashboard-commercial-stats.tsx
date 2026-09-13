"use client";

import Link from "next/link";
import { BriefcaseBusiness, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  commercialNeedsFollowUp,
  isCommercialClosed,
  type CommercialPayload,
} from "@/lib/commercial/domain";

type CommercialDashboardSnapshot = {
  payload: CommercialPayload;
  serverNow: string;
};

export function DashboardCommercialStats() {
  const [snapshot, setSnapshot] = useState<CommercialDashboardSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/desktop/commercial", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as CommercialDashboardSnapshot;
      })
      .then((result) => {
        if (active && result) setSnapshot(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const cases = snapshot?.payload.cases ?? [];
    const now = new Date(snapshot?.serverNow ?? Date.now());
    return {
      active: cases.filter((item) => !isCommercialClosed(item) && item.status !== "CONFIRMED")
        .length,
      actions: cases.filter(
        (item) => !isCommercialClosed(item) && commercialNeedsFollowUp(item, now),
      ).length,
    };
  }, [snapshot]);

  return (
    <>
      <Link className="dashboardStat dashboardStatPurple dashboardStatLink" href="/commercial">
        <span className="dashboardStatIcon">
          <BriefcaseBusiness size={20} />
        </span>
        <div>
          <strong>{snapshot ? stats.active : "—"}</strong>
          <span>Affaires actives</span>
          <small>suivi commercial</small>
        </div>
      </Link>
      <Link className="dashboardStat dashboardStatGold dashboardStatLink" href="/commercial">
        <span className="dashboardStatIcon">
          <Clock3 size={20} />
        </span>
        <div>
          <strong>{snapshot ? stats.actions : "—"}</strong>
          <span>À suivre</span>
          <small>relances ou revues arrivées</small>
        </div>
      </Link>
      <style jsx global>{`
        .dashboardStatLink {
          color: inherit;
          text-decoration: none;
          transition:
            transform 120ms ease,
            box-shadow 120ms ease;
        }
        .dashboardStatLink:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgb(59 46 98 / 0.08);
        }
      `}</style>
    </>
  );
}
