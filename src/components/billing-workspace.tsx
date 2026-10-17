"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  BillingDraft,
  BillingPayload,
  BillingSource,
  BillingType,
} from "@/lib/billing/domain";
type Snapshot = { payload: BillingPayload; sources: BillingSource[]; canWrite: boolean };
const money = (n: number) =>
  (n / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const options: { value: BillingType; label: string }[] = [
  { value: "DEPOSIT", label: "Acompte" },
  { value: "PROGRESS", label: "Situation" },
  { value: "FINAL", label: "Solde" },
  { value: "STANDARD", label: "Classique" },
];
const parseMoney = (text: string) => {
  const norm = text.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(norm) ? Math.round(Number(norm) * 100) : NaN;
};
export function BillingWorkspace({
  quoteId,
  chantierId,
}: {
  quoteId?: string;
  chantierId?: string;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(quoteId ?? "");
  const [type, setType] = useState<BillingType>("DEPOSIT");
  const [mode, setMode] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [value, setValue] = useState("");
  const [edit, setEdit] = useState<BillingDraft | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  async function refresh() {
    const response = await fetch("/api/desktop/billing", { cache: "no-store" });
    const body = (await response.json()) as Snapshot & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "BILLING_LOAD_FAILED");
    setData(body);
  }
  useEffect(() => {
    void refresh().catch(() => setError("Impossible de charger la facturation."));
  }, []);
  const sources = (data?.sources ?? []).filter(
    (s) => (!quoteId || s.quoteId === quoteId) && (!chantierId || s.chantierId === chantierId),
  );
  const active = sources.find((s) => s.quoteId === selection) ?? sources[0];
  const drafts = (data?.payload.drafts ?? []).filter(
    (d) => (!quoteId || d.quoteId === quoteId) && (!chantierId || d.chantierId === chantierId),
  );
  const used = active
    ? (data?.payload.drafts ?? [])
        .filter((d) => d.quoteId === active.quoteId)
        .reduce((n, d) => n + d.amountHtCents, 0)
    : 0;
  const remaining = Math.max(0, (active?.contractHtCents ?? 0) - used);
  async function write(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Erreur de facturation");
      await refresh();
      setNotice(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de facturation");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!active) return;
    const percentMode = mode === "PERCENT" && (type === "PROGRESS" || type === "DEPOSIT");
    const numeric = percentMode ? Number(value.replace(",", ".")) : parseMoney(value);
    if (type !== "STANDARD" && type !== "FINAL" && !Number.isFinite(numeric)) {
      setError("Montant invalide.");
      return;
    }
    const payload: Record<string, unknown> = {
      action: "CREATE",
      requestId: crypto.randomUUID(),
      quoteId: active.quoteId,
      chantierId: active.chantierId,
      type,
    };
    if (percentMode) payload.cumulativePercent = numeric;
    else if (type !== "STANDARD" && type !== "FINAL") payload.amountHtCents = numeric;
    if (await write(payload, "Projet enregistré. Aucune facture officielle émise.")) setValue("");
  }
  return (
    <div
      className="billingPage"
      style={{ padding: 24, maxWidth: 1120, margin: "auto", display: "grid", gap: 16 }}
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}
      >
        <div>
          <h1>Facturation</h1>
          <p>Préparation sans émission officielle ni Pennylane</p>
        </div>
        <Link href={chantierId ? `/chantiers/${chantierId}` : "/devis"} className="secondaryButton">
          Retour
        </Link>
      </header>
      <p style={{ padding: 12, background: "#fff7e6", borderRadius: 8 }}>
        Les montants préparés sont des brouillons analytiques : aucun numéro officiel, aucune
        écriture comptable et aucun envoi.
      </p>
      {error && (
        <p role="alert" style={{ color: "#aa2525" }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: "#236d46" }}>
          {notice}
        </p>
      )}
      {!data && <p>Chargement…</p>}
      {data && (
        <section
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 12 }}
        >
          <h2>Nouveau projet de facture</h2>
          {sources.length === 0 ? (
            <p>Aucun devis retenu éligible. Vérifie les devis retenus et leurs prix.</p>
          ) : (
            <>
              <label>
                Devis retenu{" "}
                <select
                  style={{ width: "100%", padding: 9 }}
                  value={active?.quoteId ?? ""}
                  onChange={(e) => setSelection(e.target.value)}
                >
                  {sources.map((s) => (
                    <option key={s.quoteId} value={s.quoteId}>
                      {s.affairName} · {s.quoteLabel} · {s.clientName}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                <b>Contrat :</b> {money(active?.contractHtCents ?? 0)} HT · <b>Déjà préparé :</b>{" "}
                {money(used)} HT · <b>Disponible :</b> {money(remaining)} HT
              </p>
              <label>
                Type{" "}
                <select
                  style={{ padding: 9 }}
                  value={type}
                  onChange={(e) => setType(e.target.value as BillingType)}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {type === "DEPOSIT" || type === "PROGRESS" ? (
                <>
                  <label>
                    Mode{" "}
                    <select
                      style={{ padding: 9 }}
                      value={mode}
                      onChange={(e) => setMode(e.target.value as "AMOUNT" | "PERCENT")}
                    >
                      <option value="AMOUNT">Montant HT en €</option>
                      <option value="PERCENT">
                        {type === "PROGRESS" ? "Avancement cumulé %" : "Acompte %"}
                      </option>
                    </select>
                  </label>
                  <label>
                    {mode === "PERCENT" ? "Pourcentage" : "Montant HT"}{" "}
                    <input
                      style={{ padding: 9 }}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={mode === "PERCENT" ? "30" : "2500,00"}
                    />
                  </label>
                </>
              ) : (
                <p>Le projet sera égal au montant disponible : {money(remaining)} HT.</p>
              )}
              <button
                type="button"
                className="primaryButton"
                disabled={!data.canWrite || busy || remaining <= 0}
                onClick={() => void create()}
              >
                Créer le projet
              </button>
            </>
          )}
        </section>
      )}
      {data && (
        <section
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 12 }}
        >
          <h2>Projets de facture ({drafts.length})</h2>
          {drafts.length === 0 ? (
            <p>Aucun projet pour cette sélection.</p>
          ) : (
            drafts.map((d) => (
              <article
                key={d.id}
                style={{
                  border: "1px solid #e3dfeb",
                  borderRadius: 9,
                  padding: 13,
                  display: "grid",
                  gap: 9,
                }}
              >
                <div>
                  <b>{d.label}</b> <span style={{ fontSize: 11, color: "#815ba0" }}>PROJET</span>
                </div>
                <small>
                  {d.affairName} · {d.quoteLabel} · {d.clientName}
                </small>
                <p>
                  <b>HT : {money(d.amountHtCents)}</b> · TVA : {money(d.vatCents)} ·{" "}
                  <b>TTC : {money(d.totalTtcCents)}</b>
                </p>
                {edit?.id === d.id ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <label>
                      Libellé <input value={label} onChange={(e) => setLabel(e.target.value)} />
                    </label>
                    <label>
                      Notes <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </label>
                    <button
                      className="primaryButton"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          if (
                            await write(
                              {
                                action: "UPDATE",
                                draftId: d.id,
                                expectedUpdatedAt: d.updatedAt,
                                label,
                                notes,
                              },
                              "Projet modifié",
                            )
                          )
                            setEdit(null);
                        })()
                      }
                    >
                      Enregistrer
                    </button>
                    <button className="secondaryButton" onClick={() => setEdit(null)}>
                      Annuler
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    {data.canWrite && (
                      <button
                        className="secondaryButton"
                        disabled={busy}
                        onClick={() => {
                          setEdit(d);
                          setLabel(d.label);
                          setNotes(d.notes);
                        }}
                      >
                        Modifier
                      </button>
                    )}
                    {data.canWrite && (
                      <button
                        className="secondaryButton"
                        disabled={busy}
                        onClick={() => {
                          if (confirm("Supprimer ce projet non émis ?"))
                            void write(
                              { action: "DELETE", draftId: d.id, expectedUpdatedAt: d.updatedAt },
                              "Projet supprimé",
                            );
                        }}
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}
    </div>
  );
}
