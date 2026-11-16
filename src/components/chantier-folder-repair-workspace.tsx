"use client";

import { useEffect, useState } from "react";

type AuditItem = {
  chantierId: string;
  number: string | null;
  name: string;
  status: "ACTIVE" | "DONE" | "CANCELLED" | "ARCHIVED";
  folder: string;
  action: "ALREADY_PRESENT" | "CREATE" | "MOVE" | "COMPLETE" | "CONFLICT";
  commercialLinked: boolean;
  quoteCount: number;
  retainedQuoteCount: number;
  beItemCount: number;
  warning: string | null;
};
type AuditResponse = { chantiers?: AuditItem[]; error?: string };
type RepairResponse = {
  result?: {
    chantierId: string;
    folder: string;
    filesRelinked: number;
    quotePdfsRelinked: number;
    relatedQuotes: number;
    beItems: number;
    warning: string | null;
  };
  error?: string;
};

const ACTION_LABELS: Record<AuditItem["action"], string> = {
  ALREADY_PRESENT: "Présent",
  CREATE: "Dossier à créer",
  MOVE: "Dossier commercial à déplacer",
  COMPLETE: "Arborescence à compléter",
  CONFLICT: "Contrôle manuel",
};

export function ChantierFolderRepairWorkspace() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function inspect() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/chantiers/folders", { cache: "no-store" });
      const body = (await response.json()) as AuditResponse;
      if (!response.ok || !body.chantiers) throw new Error(body.error ?? "AUDIT_FAILED");
      setItems(body.chantiers);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Inspection impossible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void inspect();
  }, []);

  const toRepair = items.filter((item) => item.action !== "ALREADY_PRESENT" && item.action !== "CONFLICT");
  const conflicts = items.filter((item) => item.action === "CONFLICT");

  async function repairAll() {
    if (busy || !backupConfirmed) return;
    setBusy(true);
    setError("");
    setLog([]);
    setProgress({ done: 0, total: toRepair.length });
    const messages: string[] = [];

    // Each chantier is processed separately: one error never prevents the
    // remaining chantiers from being checked and repaired.
    for (const [index, item] of toRepair.entries()) {
      try {
        const response = await fetch("/api/admin/chantiers/folders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chantierId: item.chantierId, confirm: true }),
        });
        const body = (await response.json()) as RepairResponse;
        if (!response.ok || !body.result) {
          throw new Error(body.error ?? "REPAIR_FAILED");
        }
        messages.push(`✓ ${item.number ?? "Sans numéro"} · ${item.name} : ${body.result.filesRelinked} document(s), ${body.result.quotePdfsRelinked} PDF de devis relié(s)${body.result.warning ? " · " + body.result.warning : ""}`);
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : "Erreur inconnue";
        messages.push(`À contrôler · ${item.number ?? "Sans numéro"} · ${item.name} : ${message}`);
      }
      setProgress({ done: index + 1, total: toRepair.length });
      setLog([...messages]);
    }
    await inspect();
    setBusy(false);
  }

  return (
    <section className="chantierFoldersRepair">
      <h1>Dossiers physiques des chantiers</h1>
      <p>
        Vérifie les chantiers déjà créés, leurs liens avec les affaires, devis et éléments BE,
        puis crée les dossiers physiques manquants (Devis-Chiffrage, Documents chantier,
        BE - Atelier, Pose, Réception, SAV…).
      </p>
      <p className="muted">
        Les documents restent uniques : aucun fichier n’est écrasé, aucun faux devis ou élément BE
        n’est inventé. Les doublons et conflits sont isolés pour vérification.
      </p>

      <div className="chantierRepairSummary">
        <span><strong>{items.length}</strong> chantiers examinés</span>
        <span><strong>{toRepair.length}</strong> à réparer</span>
        <span><strong>{conflicts.length}</strong> à contrôler manuellement</span>
      </div>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <div className="chantierRepairActions">
        <button type="button" className="secondaryButton" disabled={busy || loading} onClick={() => void inspect()}>
          {loading ? "Inspection…" : "Actualiser le diagnostic"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={backupConfirmed}
            disabled={busy}
            onChange={(event) => setBackupConfirmed(event.target.checked)}
          />
          Une sauvegarde récente de la base et des fichiers existe
        </label>
        <button
          type="button"
          className="primaryButton"
          disabled={loading || busy || !backupConfirmed || toRepair.length === 0}
          onClick={() => void repairAll()}
        >
          {busy ? `Réparation ${progress.done}/${progress.total}` : `Réparer les ${toRepair.length} dossiers`}
        </button>
      </div>

      {log.length > 0 ? (
        <article className="chantierRepairLog">
          <h2>Compte rendu des opérations</h2>
          <ul>{log.map((message, index) => <li key={index}>{message}</li>)}</ul>
        </article>
      ) : null}

      <div className="chantierRepairTableWrap">
        <table>
          <thead><tr><th>Chantier</th><th>Action prévue</th><th>Liens existants</th><th>Chemin physique</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.chantierId}>
                <td><strong>{item.number ?? "Sans numéro"} · {item.name}</strong><small>{item.status}</small></td>
                <td>{ACTION_LABELS[item.action]}{item.warning ? <small className="formError">{item.warning}</small> : null}</td>
                <td>{item.quoteCount} devis · {item.retainedQuoteCount} retenu(s) · {item.beItemCount} BE</td>
                <td><code>{item.folder}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style jsx>{`
        .chantierFoldersRepair { display:grid; gap:14px; }
        h1 { margin:0; font-size:24px; }
        h2 { font-size:16px; margin:0 0 8px; }
        p { margin:0; font-size:14px; line-height:1.5; }
        .muted { color:#746d80; }
        .chantierRepairSummary { display:flex; flex-wrap:wrap; gap:12px; }
        .chantierRepairSummary span { padding:12px 16px; border:1px solid #ded8e9; background:white; border-radius:10px; }
        .chantierRepairActions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:14px; background:#fff; border:1px solid #e4ddec; border-radius:12px; }
        .chantierRepairActions label { font-size:13px; display:flex; gap:7px; align-items:center; }
        .chantierRepairActions button { padding:9px 14px; }
        .chantierRepairLog { border:1px solid #d5c9ee; padding:13px; border-radius:12px; background:#fff; }
        .chantierRepairLog ul { margin:0; padding-left:18px; font-size:12px; line-height:1.6; }
        .chantierRepairTableWrap { overflow:auto; background:white; border:1px solid #ddd8e6; border-radius:12px; }
        table { width:100%; border-collapse:collapse; font-size:12px; min-width:850px; }
        td,th { padding:10px; text-align:left; vertical-align:top; border-bottom:1px solid #eeeaf2; }
        th { background:#f7f5fc; }
        td small { display:block; color:#847c8c; margin-top:4px; }
        td .formError { color:#ab3c51; }
        td code { overflow-wrap:anywhere; font-size:11px; }
      `}</style>
    </section>
  );
}
