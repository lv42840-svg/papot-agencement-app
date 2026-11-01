"use client";

import { useCallback, useEffect, useState } from "react";
import { parisCurrentMonth } from "@/lib/payroll/monthly-labor-costs";
import type { PayrollMonthState, PayrollSummary, OvertimeRules } from "@/lib/payroll/preparation";

type Snapshot = {
  month: string;
  canWrite: boolean;
  state: PayrollMonthState;
  current: PayrollSummary;
  latest: {
    number: number;
    summary: PayrollSummary;
    validatedAt: string;
    validatedBy: string;
  } | null;
  differences: Array<{
    personId: string;
    name: string;
    changes: Array<{ field: string; before: unknown; after: unknown }>;
  }>;
  rules: OvertimeRules;
};
const euroDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
const number = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const statusLabel = {
  PREPARING: "À préparer",
  PREPARED: "Paie préparée",
  REOPENED: "Rouverte",
} as const;

export function PayrollPreparationWorkspace() {
  const [month, setMonth] = useState(() => parisCurrentMonth());
  const [data, setData] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [showCurrent, setShowCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [reopenReason, setReopenReason] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const load = useCallback(
    async (signal: AbortSignal) => {
      setError("");
      const response = await fetch(`/api/desktop/payroll/preparation?month=${month}`, {
        cache: "no-store",
        signal,
      });
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Chargement impossible");
      setData(body);
      setNoteDrafts({});
    },
    [month],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) {
        setData(null);
        setError(cause instanceof Error ? cause.message : "Chargement impossible");
      }
    });
    return () => controller.abort();
  }, [load, revision]);
  async function mutate(input: Record<string, unknown>) {
    if (!data || !data.canWrite || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/payroll/preparation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, month, expectedRevision: data.state.revision }),
      });
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Modification impossible");
      setData(body);
      setNoteDrafts({});
      setShowCurrent(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Échec : actualise le mois et réessaie");
    } finally {
      setBusy(false);
    }
  }
  const valid = data?.month === month ? data : null;
  const frozen = valid?.state.status === "PREPARED" && !showCurrent;
  const summary = frozen && valid?.latest ? valid.latest.summary : valid?.current;
  const isEditing = !!valid?.canWrite && valid.state.status !== "PREPARED";
  const download = (version: string) =>
    `/api/desktop/payroll/preparation/export?month=${encodeURIComponent(month)}&version=${encodeURIComponent(version)}`;

  return (
    <section
      style={{ display: "grid", gap: 18, padding: 18, background: "#faf8fd", borderRadius: 12 }}
    >
      <header>
        <h2>Préparation mensuelle de paie</h2>
        <p>
          Les semaines sont rattachées en entier au mois où elles se terminent. Les semaines non
          validées utilisent la base contrat, jamais des heures saisies provisoires. Le
          téléchargement ne valide pas la paie.
        </p>
      </header>
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          Mois de paie{" "}
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) {
                setMonth(e.target.value);
                setData(null);
                setShowCurrent(false);
              }
            }}
          />
        </label>
        <button type="button" className="secondaryButton" onClick={() => setRevision((x) => x + 1)}>
          Actualiser
        </button>
        {valid ? (
          <strong>
            Statut : {statusLabel[valid.state.status]}{" "}
            {valid.latest ? `· V${valid.latest.number}` : ""}
          </strong>
        ) : null}
      </div>
      {error ? (
        <p role="alert" style={{ color: "#a22" }}>
          {error}
        </p>
      ) : null}
      {!valid ? <p>Chargement…</p> : null}
      {valid && summary ? (
        <>
          {valid.state.status === "PREPARED" && valid.latest ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>
                Version V{valid.latest.number} figée le {euroDate(valid.latest.validatedAt)} par{" "}
                {valid.latest.validatedBy}
              </strong>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => setShowCurrent((x) => !x)}
              >
                {showCurrent ? "Voir la version figée" : "Voir les données actuelles"}
              </button>
              {valid.differences.length ? (
                <span>⚠ Données modifiées depuis la dernière paie préparée</span>
              ) : null}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <label>
              Majoration à 25 % au-delà de{" "}
              <input
                type="number"
                min={0}
                max={168}
                step="0.5"
                value={valid.rules.start25}
                disabled={!isEditing || busy}
                onChange={(e) => {
                  const x = Number(e.target.value);
                  if (x < valid.rules.start50 && x >= 0)
                    void mutate({
                      action: "setOvertimeRules",
                      rules: { ...valid.rules, start25: x },
                    });
                }}
                style={{ width: 80 }}
              />{" "}
              h
            </label>
            <label>
              Majoration à 50 % au-delà de{" "}
              <input
                type="number"
                min={0}
                max={168}
                step="0.5"
                value={valid.rules.start50}
                disabled={!isEditing || busy}
                onChange={(e) => {
                  const x = Number(e.target.value);
                  if (x > valid.rules.start25 && x <= 168)
                    void mutate({
                      action: "setOvertimeRules",
                      rules: { ...valid.rules, start50: x },
                    });
                }}
                style={{ width: 80 }}
              />{" "}
              h
            </label>
            {valid.canWrite ? (
              <a
                href={download(frozen && valid.latest ? String(valid.latest.number) : "current")}
                className="secondaryButton"
              >
                Exporter Excel {frozen ? `V${valid.latest?.number}` : "actuel / brouillon"}
              </a>
            ) : null}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                minWidth: 800,
                borderCollapse: "collapse",
                background: "white",
              }}
            >
              <thead>
                <tr>
                  <th>Salarié</th>
                  <th>Heures</th>
                  <th>+25 %</th>
                  <th>+50 %</th>
                  <th>Congés (jours)</th>
                  <th>Semaines base contrat</th>
                  <th>Note paie</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => {
                  const draft = noteDrafts[row.personId] ?? row.note;
                  return (
                    <tr key={row.personId} style={{ borderTop: "1px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: 8 }}>{row.name}</th>
                      <td>{number(row.workedHours)} h</td>
                      <td>{number(row.overtime25)} h</td>
                      <td>{number(row.overtime50)} h</td>
                      <td>{number(row.vacationDays)}</td>
                      <td>{row.contractWeeks.join(", ") || "Aucune"}</td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: 4 }}>
                            <input
                              aria-label={`Note paie ${row.name}`}
                              value={draft}
                              onChange={(e) =>
                                setNoteDrafts((x) => ({ ...x, [row.personId]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="secondaryButton"
                              disabled={busy || draft === row.note}
                              onClick={() =>
                                void mutate({
                                  action: "setNote",
                                  personId: row.personId,
                                  note: draft,
                                })
                              }
                            >
                              Sauver
                            </button>
                          </div>
                        ) : (
                          row.note
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Détail des semaines et des absences</summary>
            {summary.rows.map((row) => (
              <div key={row.personId} style={{ padding: 12, borderBottom: "1px solid #ddd" }}>
                <h3>{row.name}</h3>
                {row.weeks.map((week) => (
                  <div
                    key={week.week}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      padding: "4px 0",
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>{week.week}</strong>
                    <span>{number(week.hours)} h</span>
                    <span>{week.source === "REAL" ? "Heures validées" : "Base contrat"}</span>
                    <span>Absences : {number(week.absenceHours)} h</span>
                    <span>Validation depuis la saisie des heures du Planning</span>
                  </div>
                ))}
                {row.absences.map((abs, index) => (
                  <p key={`${abs.date}:${index}`}>
                    {abs.date} · {abs.type} · {number(abs.hours)} h
                  </p>
                ))}
              </div>
            ))}
          </details>
          {valid.differences.length > 0 && (
            <details>
              <summary>
                Comparer avec la dernière version validée ({valid.differences.length} salarié(s)
                avec écarts)
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={onlyChanged}
                  onChange={(e) => setOnlyChanged(e.target.checked)}
                />{" "}
                Salariés modifiés seulement
              </label>
              {(onlyChanged
                ? valid.differences
                : summary.rows.map(
                    (row) =>
                      valid.differences.find((d) => d.personId === row.personId) ?? {
                        personId: row.personId,
                        name: row.name,
                        changes: [],
                      },
                  )
              ).map((row) => (
                <p key={row.personId}>
                  <strong>{row.name} :</strong>{" "}
                  {row.changes.length
                    ? row.changes
                        .map(
                          (c) =>
                            `${c.field} (${JSON.stringify(c.before)} → ${JSON.stringify(c.after)})`,
                        )
                        .join(" ; ")
                    : "Sans modification"}
                </p>
              ))}
            </details>
          )}
          <section style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {isEditing && (
              <button
                type="button"
                className="primaryButton"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Confirmer « Paie préparée » pour ${month} en V${valid.state.versions.length + 1} ?`,
                    )
                  )
                    void mutate({ action: "validate" });
                }}
              >
                Valider {month} en V{valid.state.versions.length + 1}
              </button>
            )}
            {valid.state.status === "PREPARED" && valid.canWrite && (
              <>
                <input
                  aria-label="Motif de réouverture"
                  placeholder="Motif de réouverture obligatoire"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                />
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={busy || reopenReason.trim().length < 3}
                  onClick={() => void mutate({ action: "reopen", reason: reopenReason })}
                >
                  Rouvrir
                </button>
              </>
            )}
            {valid.state.status === "REOPENED" && valid.canWrite && (
              <button
                type="button"
                className="secondaryButton"
                disabled={busy || valid.differences.length > 0}
                onClick={() => void mutate({ action: "restore" })}
              >
                Revenir à la version précédente sans nouvelle V
              </button>
            )}
          </section>
          {valid.state.versions.length > 0 && (
            <details>
              <summary>Historique de validation ({valid.state.versions.length} versions)</summary>
              {valid.state.versions.map((item) => (
                <p key={item.number}>
                  <strong>V{item.number}</strong> · {euroDate(item.validatedAt)} ·{" "}
                  {item.validatedBy} {item.reopenReason ? `· Motif : ${item.reopenReason}` : ""}{" "}
                  {valid.canWrite && (
                    <a href={download(String(item.number))}>Télécharger Excel V{item.number}</a>
                  )}
                </p>
              ))}
              {valid.state.eventLog
                .filter((e) => e.action === "reopen")
                .map((e, i) => (
                  <p key={i}>
                    Réouverture : {euroDate(e.at)} · {e.by} · {e.reason}
                  </p>
                ))}
            </details>
          )}
        </>
      ) : null}
      <details style={{ marginTop: 16 }}>
        <summary>Modèle Excel de paie (administration)</summary>
        <p>
          La feuille Synthèse reçoit les données de paie. Les largeurs de colonnes et les autres
          feuilles sont conservées. Personnalise le fichier dans Excel puis remplace le modèle.
        </p>
        <a href="/api/desktop/payroll/preparation/template">Télécharger le modèle Excel</a>
        <label>
          Remplacer le modèle{" "}
          <input
            type="file"
            accept=".xlsx"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("file", file);
              const response = await fetch("/api/desktop/payroll/preparation/template", {
                method: "POST",
                body: form,
              });
              const body = await response.json();
              window.alert(
                response.ok ? "Modèle enregistré." : (body.error ?? "Enregistrement impossible."),
              );
              event.target.value = "";
            }}
          />
        </label>
      </details>
    </section>
  );
}
