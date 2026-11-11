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
      .then(async (reponse) => {
        if (!reponse.ok) return null;
        return (await reponse.json()) as ChantiersDashboardSnapshot;
      })
      .then((resultat) => {
        if (active && resultat) setSnapshot(resultat);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const activeCount = useMemo(
    () => snapshot?.payload.chantiers.filter((element) => element.status === "ACTIVE").length ?? 0,
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
