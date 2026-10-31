"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(quoteId ?? "");
  const [type, setType] = useState<BillingType>("DEPOSIT");
  const [mode, setMode] = useState<"AMOUNT" | "PERCENT" | "LINES">("PERCENT");
  const [lineValues, setLineValues] = useState<Record<string, string>>({});
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
  function previousPercents(source: BillingSource): Record<string, string> {
    const latest = (data?.payload.drafts ?? [])
      .filter((draft) => draft.quoteId === source.quoteId && draft.type === "PROGRESS")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
    return Object.fromEntries(
      (source.lines ?? []).map((line) => [
        line.lineId,
        String(
          latest?.lineProgress?.find((progress) => progress.lineId === line.lineId)?.percent ??
            latest?.cumulativePercent ??
            0,
        ),
      ]),
    );
  }
  const cumulativeLinesCents = (active?.lines ?? []).reduce((sum, line) => {
    const percent = Number((lineValues[line.lineId] ?? "0").replace(",", "."));
    return sum + (Number.isFinite(percent) ? Math.round((line.amountHtCents * percent) / 100) : 0);
  }, 0);
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
      const result = (await response.json()) as { error?: string; payload?: BillingPayload };
      if (!response.ok) throw new Error(result.error ?? "Erreur de facturation");
      await refresh();
      setNotice(success);
      return result.payload ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de facturation");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!active) return;
    const linesMode = type === "PROGRESS" && mode === "LINES";
    const percentMode = mode === "PERCENT" && (type === "PROGRESS" || type === "DEPOSIT");
    const numeric = percentMode ? Number(value.replace(",", ".")) : parseMoney(value);
    if (!linesMode && type !== "STANDARD" && type !== "FINAL" && !Number.isFinite(numeric)) {
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
    if (linesMode) {
      const rows = (active.lines ?? []).map((line) => ({
        lineId: line.lineId,
        percent: Number((lineValues[line.lineId] ?? "").replace(",", ".")),
      }));
      if (
        rows.length === 0 ||
        rows.some((row) => !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100)
      ) {
        setError("Renseigne un avancement entre 0 et 100 % pour chaque ligne.");
        return;
      }
      payload.linePercentages = rows;
    } else if (percentMode) payload.cumulativePercent = numeric;
    else if (type !== "STANDARD" && type !== "FINAL") payload.amountHtCents = numeric;
    const result = await write(
      payload,
      "Projet enregistré. Aucune facture officielle émise. Ouvre son éditeur pour personnaliser les lignes.",
    );
    const created = result?.drafts.find((draft) => draft.requestId === payload.requestId);
    if (created) router.push(`/facturation/${encodeURIComponent(created.id)}`);
    else if (result) setValue("");
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
          <h2>Créer une facture depuis le devis, puis modifier ses lignes</h2>
          {sources.length === 0 ? (
            <p>Aucun devis retenu éligible. Vérifie les devis retenus et leurs prix.</p>
          ) : (
            <>
              <label>
                Devis retenu{" "}
                <select
                  style={{ width: "100%", padding: 9 }}
                  value={active?.quoteId ?? ""}
                  onChange={(e) => {
                    setSelection(e.target.value);
                    const source = sources.find((item) => item.quoteId === e.target.value);
                    if (source) setLineValues(previousPercents(source));
                  }}
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
                  onChange={(e) => {
                    setType(e.target.value as BillingType);
                    setMode(e.target.value === "PROGRESS" ? "LINES" : "PERCENT");
                  }}
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
                      onChange={(e) => {
                        const next = e.target.value as "AMOUNT" | "PERCENT" | "LINES";
                        setMode(next);
                        if (next === "LINES" && active) {
                          setLineValues(previousPercents(active));
                        }
                      }}
                    >
                      <option value="AMOUNT">Montant HT en € (optionnel)</option>
                      <option value="PERCENT">
                        {type === "PROGRESS" ? "Avancement global cumulé %" : "Acompte %"}
                      </option>
                      {type === "PROGRESS" && (active?.lines?.length ?? 0) > 0 ? (
                        <option value="LINES">Avancement par ligne (%)</option>
                      ) : null}
                    </select>
                  </label>
                  {mode !== "LINES" && (
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
                  )}
                  {type === "PROGRESS" && mode === "LINES" && active?.lines?.length ? (
                    <div style={{ display: "grid", gap: 9 }}>
                      <p>
                        Indique l&apos;avancement <strong>cumulé</strong> de chaque ligne. PAPOT
                        soustraira les projets précédents, y compris les acomptes.
                      </p>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 550 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left" }}>Ligne du devis</th>
                              <th>Montant HT</th>
                              <th>Avancement précédent</th>
                              <th>Nouvel avancement %</th>
                              <th>Cumul HT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {active.lines.map((line) => {
                              const previous = Number(previousPercents(active)[line.lineId] ?? "0");
                              const entered = lineValues[line.lineId] ?? String(previous);
                              const percent = Number(entered.replace(",", "."));
                              const cumulative = Number.isFinite(percent)
                                ? Math.round((line.amountHtCents * percent) / 100)
                                : 0;
                              return (
                                <tr key={line.lineId}>
                                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                                    {line.description}
                                  </td>
                                  <td style={{ textAlign: "right", padding: 8 }}>
                                    {money(line.amountHtCents)}
                                  </td>
                                  <td style={{ textAlign: "center", padding: 8 }}>{previous} %</td>
                                  <td style={{ textAlign: "center", padding: 8 }}>
                                    <input
                                      aria-label={`Avancement ${line.description}`}
                                      style={{ maxWidth: 95, padding: 8 }}
                                      inputMode="decimal"
                                      value={entered}
                                      onChange={(e) =>
                                        setLineValues((current) => ({
                                          ...current,
                                          [line.lineId]: e.target.value,
                                        }))
                                      }
                                    />
                                  </td>
                                  <td style={{ textAlign: "right", padding: 8 }}>
                                    {money(cumulative)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p>
                        <strong>Avancement cumulé : {money(cumulativeLinesCents)} HT.</strong> Déjà
                        préparé : {money(used)} HT. Projet complémentaire estimé :{" "}
                        {money(cumulativeLinesCents - used)} HT.
                      </p>
                      <small>
                        Les retours en arrière et les répartitions de TVA incompatibles avec les
                        acomptes antérieurs sont bloqués.
                      </small>
                    </div>
                  ) : null}
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
                <div>
                  <Link href={`/facturation/${encodeURIComponent(d.id)}`} className="primaryButton">
                    Ouvrir et modifier la facture
                  </Link>
                </div>
                {d.lineProgress?.length ? (
                  <details>
                    <summary>Avancement cumulé par ligne</summary>
                    <ul>
                      {d.lineProgress.map((row) => (
                        <li key={row.lineId}>
                          {d.lines?.find((line) => line.lineId === row.lineId)?.description ??
                            "Ligne"}
                          {" : "}
                          {row.percent} % · {money(row.cumulativeHtCents)} HT cumulés
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
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
