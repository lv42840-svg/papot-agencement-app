"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChantiersPayload } from "@/lib/chantiers/domain";

type ChantiersDashboardSnapshot = {
  payload: ChantiersPayload;
};

export function DashboardChantierStat() {
  const [snapshot, setSnapshot] = useState<ChantiersDashboardSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/desktop/chantiers", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ChantiersDashboardSnapshot;
      })
      .then((result) => {
        if (active && result) setSnapshot(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const activeCount = useMemo(
    () => snapshot?.payload.chantiers.filter((item) => item.status === "ACTIVE").length ?? 0,
    [snapshot],
  );

  return (
    <Link className="dashboardStat dashboardStatGreen dashboardStatLink" href="/chantiers">
      <span className="dashboardStatIcon">
        <FolderOpen size={20} />
      </span>
      <div>
        <strong>{snapshot ? activeCount : "—"}</strong>
        <span>Chantiers actifs</span>
        <small>suivi opérationnel</small>
      </div>
    </Link>
  );
}
