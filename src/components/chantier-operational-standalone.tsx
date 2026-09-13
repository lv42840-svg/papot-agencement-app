"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChantierOperationalWorkspace } from "@/components/chantier-operational-workspace";
import type { ChantiersPayload } from "@/lib/chantiers/domain";
import type { ChantierCapabilities } from "@/lib/chantiers/mutations";

type Snapshot = {
  payload: ChantiersPayload;
  actor: { userId: string; displayName: string };
  capabilities: ChantierCapabilities;
  focusChantierId?: string;
  serverNow: string;
};

type MutationBody = Record<string, unknown> & { action: string };

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  CHANTIERS_LOCKED: "Le chantier est modifié sur un autre poste. Réessaie dans quelques secondes.",
  CHANTIERS_VERSION_CONFLICT: "Le chantier a changé sur un autre poste. Actualise puis réessaie.",
  CHANTIER_ARCHIVED_READ_ONLY: "Ce chantier est archivé. Réactive-le avant de modifier son suivi.",
  CHANTIER_BE_ITEM_NOT_FOUND: "L'élément BE n'existe plus.",
  CHANTIER_WORKSHOP_ITEM_NOT_FOUND: "L'élément Atelier n'existe plus.",
  CHANTIER_INSTALL_ITEM_NOT_FOUND: "L'élément Pose n'existe plus.",
};

export function ChantierOperationalStandalone({ chantierId }: { chantierId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/chantiers", { cache: "no-store" });
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "CHANTIERS_LOAD_FAILED");
      setSnapshot(body);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "CHANTIERS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger le suivi opérationnel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chantier = useMemo(
    () => snapshot?.payload.chantiers.find((item) => item.id === chantierId) ?? null,
    [snapshot, chantierId],
  );

  const mutate = useCallback(async (body: MutationBody, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/desktop/chantiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "CHANTIERS_MUTATION_FAILED");
      setSnapshot(result);
      setNotice(successMessage);
      return true;
    } catch (mutationError) {
      const code = mutationError instanceof Error ? mutationError.message : "CHANTIERS_MUTATION_FAILED";
      setError(errorMessages[code] ?? "La modification du suivi opérationnel a échoué.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading && !snapshot) {
    return <div className="chantierOperationalLoading"><RefreshCw size={17} /> Chargement BE / Atelier / Pose…</div>;
  }
  if (!chantier || !snapshot) return null;

  return (
    <div className="chantierOperationalStandalone">
      <div className="chantierOperationalStandaloneTitle">
        <div><strong>Suivi chantier · BE / Atelier / Pose</strong><span>Première brique opérationnelle réelle du chantier.</span></div>
        <button type="button" onClick={() => void load()} disabled={busy}><RefreshCw size={13} /> Actualiser</button>
      </div>
      {error ? <div className="chantierOperationalMessage isError">{error}</div> : null}
      {notice ? <div className="chantierOperationalMessage isSuccess">{notice}</div> : null}
      <ChantierOperationalWorkspace
        chantier={chantier}
        busy={busy}
        canModify={snapshot.capabilities.canModify && chantier.status !== "ARCHIVED"}
        mutate={mutate}
      />
      <style jsx global>{`
        .chantierOperationalStandalone{display:grid;gap:9px;margin-top:14px}.chantierOperationalStandaloneTitle{display:flex;align-items:center;justify-content:space-between;gap:10px}.chantierOperationalStandaloneTitle>div{display:grid;gap:2px}.chantierOperationalStandaloneTitle strong{font-size:12px}.chantierOperationalStandaloneTitle span{color:#918a97;font-size:8.5px}.chantierOperationalStandaloneTitle button{min-height:31px;padding:0 9px;display:inline-flex;align-items:center;gap:5px;border:1px solid #ddd8e5;border-radius:7px;background:#fff;color:#625b69;font-size:8.5px}.chantierOperationalMessage{padding:9px 11px;border-radius:8px;font-size:9px}.chantierOperationalMessage.isError{border:1px solid #efc4bc;background:#fff5f3;color:#a3493a}.chantierOperationalMessage.isSuccess{border:1px solid #c4e4cf;background:#f1faf4;color:#347850}.chantierOperationalLoading{min-height:100px;margin-top:14px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #e8e4ef;border-radius:10px;background:#fff;color:#8a8592;font-size:9px}@media(max-width:620px){.chantierOperationalStandaloneTitle{align-items:flex-start;flex-direction:column}}
      `}</style>
    </div>
  );
}
