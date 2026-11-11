"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseBillingPercentageInput } from "@/lib/billing/percentage-input";
import { calculateLineProgress } from "@/lib/billing/progress";
import { filterBillingProjects, type BillingProjectSort } from "@/lib/billing/workspace-list";
import {
  billingPreparationFollowup,
  type BillingPreparationStatus,
} from "@/lib/billing/preparation-followup";
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
const parseMoney = (texte: string) => {
  const norm = texte.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(norm) ? Math.round(Number(norm) * 100) : NaN;
};
export function BillingWorkspace({
  quoteId: idDevis,
  chantierId,
  initialTab,
}: {
  quoteId?: string;
  chantierId?: string;
  initialTab?: string;
}) {
  const router = useRouter();
  const [donnees, setData] = useState<Snapshot | null>(null);
  const [erreur, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectionCourante, setSelection] = useState(idDevis ?? "");
  const [type, setType] = useState<BillingType>("DEPOSIT");
  const [mode, setMode] = useState<"AMOUNT" | "PERCENT" | "LINES">("PERCENT");
  const [lineValues, setLineValues] = useState<Record<string, string>>({});
  const [valeur, setValue] = useState("");
  const [tab, setTab] = useState<"CHANTIER" | "PROJECTS" | "FOLLOWUP">(
    chantierId ? "CHANTIER" : initialTab === "FOLLOWUP" ? "FOLLOWUP" : "PROJECTS",
  );
  const [selectedChantier, setSelectedChantier] = useState(chantierId ?? "");
  const [projectSearch, setProjectSearch] = useState("");
  const [followupSearch, setFollowupSearch] = useState("");
  const [followupStatus, setFollowupStatus] = useState<BillingPreparationStatus | "ALL">("ALL");
  const [projectStatus, setProjectStatus] = useState<"ALL" | BillingDraft["status"]>("ALL");
  const [projectType, setProjectType] = useState<"ALL" | BillingType>("ALL");
  const [projectChantier, setProjectChantier] = useState("ALL");
  const [projectSort, setProjectSort] = useState<BillingProjectSort>("RECENT");
  async function refresh() {
    const reponse = await fetch("/api/desktop/billing", { cache: "no-store" });
    const corps = (await reponse.json()) as Snapshot & { error?: string };
    if (!reponse.ok) throw new Error(corps.error ?? "BILLING_LOAD_FAILED");
    setData(corps);
  }
  useEffect(() => {
    void refresh().catch(() => setError("Impossible de charger la facturation."));
  }, []);
  const allSources = donnees?.sources ?? [];
  const chantierChoices = [
    ...new Map<string, { id: string; name: string; client: string }>(
      allSources
        .filter((source) => source.chantierId !== null)
        .map((source) => [
          source.chantierId!,
          { id: source.chantierId!, name: source.affairName, client: source.clientName },
        ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "fr-FR"));
  const activeChantierId = chantierChoices.some((site) => site.id === selectedChantier)
    ? selectedChantier
    : (chantierChoices[0]?.id ?? "");
  const sources = allSources.filter((source) => source.chantierId === activeChantierId);
  const active = sources.find((source) => source.quoteId === selectionCourante) ?? sources[0];
  const brouillons = donnees?.payload.drafts ?? [];
  const followup = billingPreparationFollowup(allSources, brouillons);
  const visibleFollowup = followup.filter((ligneTableau) => {
    if (followupStatus !== "ALL" && ligneTableau.status !== followupStatus) return false;
    const needle = followupSearch.trim().toLocaleLowerCase("fr-FR");
    return (
      !needle ||
      [
        ligneTableau.source.clientName,
        ligneTableau.source.affairName,
        ligneTableau.source.quoteLabel,
      ]
        .join(" ")
        .toLocaleLowerCase("fr-FR")
        .includes(needle)
    );
  });
  const projectChantiers = [
    ...new Map<string, { id: string; label: string }>(
      brouillons
        .filter((brouillon) => brouillon.chantierId !== null)
        .map((brouillon) => [
          brouillon.chantierId!,
          { id: brouillon.chantierId!, label: brouillon.affairName },
        ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "fr-FR"));
  const visibleDrafts = filterBillingProjects(brouillons, {
    search: projectSearch,
    status: projectStatus,
    type: projectType,
    chantierId: projectChantier,
    sort: projectSort,
  });
  const used = active
    ? (donnees?.payload.drafts ?? [])
        .filter((d) => d.quoteId === active.quoteId)
        .reduce((n, d) => n + d.amountHtCents, 0)
    : 0;
  const remaining = Math.max(0, (active?.contractHtCents ?? 0) - used);
  function previousPercents(source: BillingSource): Record<string, string> {
    const latest = (donnees?.payload.drafts ?? [])
      .filter((brouillon) => brouillon.quoteId === source.quoteId && brouillon.type === "PROGRESS")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
    return Object.fromEntries(
      (source.lines ?? []).map((ligne) => [
        ligne.lineId,
        String(
          latest?.lineProgress?.find((progress) => progress.lineId === ligne.lineId)?.percent ??
            latest?.cumulativePercent ??
            0,
        ),
      ]),
    );
  }
  // Preview and submit the same percentages, including visible saved defaults.
  const previousLineValues = active ? previousPercents(active) : {};
  const enteredLineRows = (active?.lines ?? []).map((ligne) => ({
    lineId: ligne.lineId,
    percent: Number(
      (lineValues[ligne.lineId] ?? previousLineValues[ligne.lineId] ?? "0").replace(",", "."),
    ),
  }));
  const cumulativeLinesCents = (active?.lines ?? []).reduce((somme, ligne, indice) => {
    const percent = enteredLineRows[indice]?.percent;
    const lineValue =
      typeof percent === "number" && Number.isFinite(percent)
        ? Math.round((ligne.amountHtCents * percent) / 100)
        : 0;
    return somme + lineValue;
  }, 0);
  const progressPreviewError = (() => {
    if (type !== "PROGRESS" || mode !== "LINES" || !active || !donnees) return "";
    try {
      calculateLineProgress(donnees.payload, active, enteredLineRows);
      return "";
    } catch (erreur) {
      const code = erreur instanceof Error ? erreur.message : "";
      if (code === "BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE") {
        if (cumulativeLinesCents < used) {
          const minimum =
            active.lines?.length === 1
              ? ` Sur cette ligne, indique plus de ${((used / active.contractHtCents) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %.`
              : "";
          return `Avancement cumulé insuffisant : ${money(cumulativeLinesCents)} HT contre ${money(used)} HT déjà préparés (acomptes inclus).${minimum}`;
        }
        return "Les pourcentages doivent couvrir les acomptes déjà préparés pour chaque taux de TVA.";
      }
      if (code === "BILLING_AMOUNT_INVALID") {
        return cumulativeLinesCents === used
          ? "Aucun montant complémentaire à facturer : augmente l'avancement cumulé."
          : "Indique un avancement positif supérieur aux montants déjà préparés.";
      }
      if (code === "BILLING_PROGRESS_CANNOT_DECREASE") {
        return "Une situation ne peut pas revenir en dessous de l'avancement déjà enregistré.";
      }
      if (
        code === "BILLING_PROGRESS_PERCENT_INVALID" ||
        code === "BILLING_PROGRESS_LINES_REQUIRED"
      ) {
        return "Indique un pourcentage entre 0 et 100 % pour chaque ligne.";
      }
      return "Vérifie les avancements cumulés avant de créer cette situation.";
    }
  })();
  async function write(corps: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reponse = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
      const resultat = (await reponse.json()) as {
        error?: string;
        fields?: string[];
        payload?: BillingPayload;
      };
      if (!reponse.ok) {
        const fields = resultat.fields?.length ? ` (champs : ${resultat.fields.join(", ")})` : "";
        if (resultat.error === "BILLING_REQUEST_INVALID") {
          throw new Error(`La demande de facturation est invalide${fields}.`);
        }
        if (resultat.error === "BILLING_DRAFT_DATA_INVALID") {
          throw new Error(
            `Des données du devis empêchent la création${fields}. Vérifie les lignes du devis.`,
          );
        }
        throw new Error(resultat.error ?? "Erreur de facturation");
      }
      await refresh();
      setNotice(success);
      return resultat.payload ?? null;
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
    const numeric = percentMode ? parseBillingPercentageInput(valeur) : parseMoney(valeur);
    if (percentMode && numeric === null) {
      setError("Saisis un pourcentage entre 0,01 et 100 (par exemple 30).");
      return;
    }
    if (!linesMode && type !== "STANDARD" && type !== "FINAL" && !Number.isFinite(numeric)) {
      setError("Montant invalide.");
      return;
    }
    const contenu: Record<string, unknown> = {
      action: "CREATE",
      requestId: crypto.randomUUID(),
      quoteId: active.quoteId,
      chantierId: active.chantierId,
      type,
    };
    if (linesMode) {
      if (progressPreviewError) {
        setError(progressPreviewError);
        return;
      }
      const lignesTableau = enteredLineRows;
      if (
        lignesTableau.length === 0 ||
        lignesTableau.some(
          (ligneTableau) =>
            !Number.isFinite(ligneTableau.percent) ||
            ligneTableau.percent < 0 ||
            ligneTableau.percent > 100,
        )
      ) {
        setError("Renseigne un avancement entre 0 et 100 % pour chaque ligne.");
        return;
      }
      contenu.linePercentages = lignesTableau;
    } else if (percentMode) contenu.cumulativePercent = numeric;
    else if (type !== "STANDARD" && type !== "FINAL") contenu.amountHtCents = numeric;
    const resultat = await write(
      contenu,
      "Projet enregistré. Aucune facture officielle émise. Ouvre son éditeur pour personnaliser les lignes.",
    );
    const created = resultat?.drafts.find((brouillon) => brouillon.requestId === contenu.requestId);
    if (created) router.push(`/facturation/${encodeURIComponent(created.id)}`);
    else if (resultat) setValue("");
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
      {erreur && (
        <p role="alert" style={{ color: "#aa2525" }}>
          {erreur}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: "#236d46" }}>
          {notice}
        </p>
      )}
      <div
        role="tablist"
        aria-label="Rubriques de facturation"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {(
          [
            ["CHANTIER", "Nouvelle facture depuis chantier"],
            ["PROJECTS", `Projets de factures (${brouillons.length})`],
            ["FOLLOWUP", `Devis à facturer (${followup.length})`],
          ] as const
        ).map(([cle, caption]) => (
          <button
            key={cle}
            type="button"
            role="tab"
            aria-selected={tab === cle}
            className={tab === cle ? "primaryButton" : "secondaryButton"}
            onClick={() => {
              setTab(cle);
              setSelection("");
              setLineValues({});
              setValue("");
              setError("");
              setNotice("");
            }}
          >
            {caption}
          </button>
        ))}
      </div>
      {!donnees && <p>Chargement…</p>}
      {donnees && tab === "CHANTIER" && (
        <section
          role="tabpanel"
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 12 }}
        >
          <h2>Nouvelle facture depuis un chantier</h2>
          <label>
            Chantier
            {chantierChoices.length > 0 ? (
              <select
                aria-label="Choisir un chantier à facturer"
                style={{ width: "100%", padding: 9 }}
                value={activeChantierId}
                onChange={(e) => {
                  setSelectedChantier(e.target.value);
                  setSelection("");
                  setLineValues({});
                  setError("");
                }}
              >
                {chantierChoices.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} · {site.client}
                  </option>
                ))}
              </select>
            ) : (
              <p>Aucun chantier avec un devis retenu éligible à la facturation.</p>
            )}
          </label>
          {sources.length === 0 ? (
            <p>
              Aucun devis retenu éligible pour cette sélection. Vérifie les devis retenus et leurs
              prix.
            </p>
          ) : (
            <>
              <label>
                Devis retenu{" "}
                <select
                  style={{ width: "100%", padding: 9 }}
                  value={active?.quoteId ?? ""}
                  onChange={(e) => {
                    setSelection(e.target.value);
                    const source = sources.find((element) => element.quoteId === e.target.value);
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
                        const suivant = e.target.value as "AMOUNT" | "PERCENT" | "LINES";
                        setMode(suivant);
                        if (suivant === "LINES" && active) {
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
                        value={valeur}
                        onChange={(e) => {
                          setValue(e.target.value);
                          setError("");
                        }}
                        placeholder={
                          mode === "PERCENT" ? "Ex. 30 (à saisir)" : "Ex. 2500,00 (à saisir)"
                        }
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
                            {active.lines.map((ligne) => {
                              const precedent = Number(previousLineValues[ligne.lineId] ?? "0");
                              const entered = lineValues[ligne.lineId] ?? String(precedent);
                              const percent = Number(entered.replace(",", "."));
                              const cumulative = Number.isFinite(percent)
                                ? Math.round((ligne.amountHtCents * percent) / 100)
                                : 0;
                              return (
                                <tr key={ligne.lineId}>
                                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                                    {ligne.description}
                                  </td>
                                  <td style={{ textAlign: "right", padding: 8 }}>
                                    {money(ligne.amountHtCents)}
                                  </td>
                                  <td style={{ textAlign: "center", padding: 8 }}>{precedent} %</td>
                                  <td style={{ textAlign: "center", padding: 8 }}>
                                    <input
                                      aria-label={`Avancement ${ligne.description}`}
                                      style={{ maxWidth: 95, padding: 8 }}
                                      inputMode="decimal"
                                      value={entered}
                                      onChange={(e) => {
                                        setLineValues((courant) => ({
                                          ...courant,
                                          [ligne.lineId]: e.target.value,
                                        }));
                                        setError("");
                                      }}
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
                      {progressPreviewError ? (
                        <p role="status" style={{ color: "#aa2525" }}>
                          {progressPreviewError}
                        </p>
                      ) : null}
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
                disabled={
                  !donnees.canWrite || busy || remaining <= 0 || Boolean(progressPreviewError)
                }
                onClick={() => void create()}
              >
                Créer le projet
              </button>
            </>
          )}
        </section>
      )}
      {donnees && tab === "FOLLOWUP" && (
        <section
          role="tabpanel"
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 14 }}
        >
          <h2>Devis acceptés et suivi de préparation des factures</h2>
          <p>
            Un devis signé n&apos;est pas une facture. Les acomptes, situations et soldes ci-dessous
            sont uniquement des <strong>projets PAPOT non émis</strong>. En attendant Pennylane,
            l&apos;état réellement non facturé ou partiellement facturé ne peut pas être certifié.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <strong>{followup.length} devis retenu(s)</strong>
            <strong>
              {money(followup.reduce((s, r) => s + r.preparedHtCents, 0))} HT en projets
            </strong>
            <strong>
              {money(followup.reduce((s, r) => s + r.remainingToPrepareHtCents, 0))} HT à préparer
            </strong>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 5, flex: "2 1 220px" }}>
              Rechercher un devis accepté
              <input
                value={followupSearch}
                onChange={(evenement) => setFollowupSearch(evenement.target.value)}
                placeholder="Chantier, client ou référence"
              />
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 180px" }}>
              Préparation des factures
              <select
                value={followupStatus}
                onChange={(evenement) =>
                  setFollowupStatus(evenement.target.value as typeof followupStatus)
                }
              >
                <option value="ALL">Tous les devis</option>
                <option value="NONE">Aucun projet</option>
                <option value="PARTIAL">Projets partiels</option>
                <option value="FULL">Totalité préparée (non émise)</option>
              </select>
            </label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                  <th style={{ padding: 9 }}>Client / chantier</th>
                  <th style={{ padding: 9 }}>Devis accepté</th>
                  <th style={{ padding: 9, textAlign: "right" }}>Contrat HT</th>
                  <th style={{ padding: 9, textAlign: "right" }}>Projets préparés HT</th>
                  <th style={{ padding: 9, textAlign: "right" }}>Reste à préparer HT</th>
                  <th style={{ padding: 9 }}>État des projets</th>
                  <th style={{ padding: 9 }}>Facturé réel</th>
                  <th style={{ padding: 9 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleFollowup.map((ligneTableau) => (
                  <tr
                    key={ligneTableau.source.quoteId}
                    style={{ borderBottom: "1px solid #ece8f0" }}
                  >
                    <td style={{ padding: 9 }}>
                      <strong>{ligneTableau.source.clientName}</strong>
                      <div>{ligneTableau.source.affairName}</div>
                    </td>
                    <td style={{ padding: 9 }}>
                      <Link href={`/devis/${encodeURIComponent(ligneTableau.source.quoteId)}`}>
                        {ligneTableau.source.quoteLabel}
                      </Link>
                    </td>
                    <td style={{ padding: 9, textAlign: "right" }}>
                      {money(ligneTableau.source.contractHtCents)}
                    </td>
                    <td style={{ padding: 9, textAlign: "right" }}>
                      {money(ligneTableau.preparedHtCents)}
                    </td>
                    <td style={{ padding: 9, textAlign: "right" }}>
                      {money(ligneTableau.remainingToPrepareHtCents)}
                    </td>
                    <td style={{ padding: 9 }}>
                      {ligneTableau.status === "NONE"
                        ? "Aucun projet"
                        : ligneTableau.status === "PARTIAL"
                          ? "Préparation partielle"
                          : "Totalité préparée"}
                      <div style={{ fontSize: 11 }}>
                        {ligneTableau.projectCount} projet(s) non émis
                      </div>
                    </td>
                    <td style={{ padding: 9 }}>À rapprocher avec Pennylane</td>
                    <td style={{ padding: 9 }}>
                      {ligneTableau.source.chantierId ? (
                        <button
                          type="button"
                          className="secondaryButton"
                          onClick={() => {
                            setSelectedChantier(ligneTableau.source.chantierId!);
                            setSelection(ligneTableau.source.quoteId);
                            setTab("CHANTIER");
                            setValue("");
                          }}
                        >
                          Préparer une facture
                        </button>
                      ) : (
                        <Link
                          className="secondaryButton"
                          href={`/devis/${encodeURIComponent(ligneTableau.source.quoteId)}`}
                        >
                          Voir le devis
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleFollowup.length ? <p>Aucun devis ne correspond aux filtres.</p> : null}
          </div>
        </section>
      )}
      {donnees && tab === "PROJECTS" && (
        <section
          role="tabpanel"
          style={{ background: "white", padding: 20, borderRadius: 12, display: "grid", gap: 12 }}
        >
          <h2>Projets de factures ({brouillons.length})</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ display: "grid", gap: 5, flex: "2 1 220px" }}>
              Rechercher (client, chantier, devis)
              <input
                aria-label="Rechercher un projet de facture"
                value={projectSearch}
                placeholder="Nom, référence, libellé…"
                onChange={(e) => setProjectSearch(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 125px" }}>
              Statut
              <select
                aria-label="Filtrer par statut"
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value as typeof projectStatus)}
              >
                <option value="ALL">Tous</option>
                <option value="DRAFT">À préparer</option>
                <option value="APPROVED">Validés en interne</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 125px" }}>
              Type
              <select
                aria-label="Filtrer par type"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as typeof projectType)}
              >
                <option value="ALL">Tous</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 170px" }}>
              Chantier
              <select
                aria-label="Filtrer par chantier"
                value={projectChantier}
                onChange={(e) => setProjectChantier(e.target.value)}
              >
                <option value="ALL">Tous les chantiers</option>
                <option value="NONE">Sans chantier</option>
                {projectChantiers.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, flex: "1 1 135px" }}>
              Trier par
              <select
                aria-label="Trier les projets de factures"
                value={projectSort}
                onChange={(e) => setProjectSort(e.target.value as BillingProjectSort)}
              >
                <option value="RECENT">Plus récents</option>
                <option value="OLDEST">Plus anciens</option>
                <option value="CLIENT">Client A-Z</option>
                <option value="AMOUNT_DESC">Montant HT décroissant</option>
              </select>
            </label>
          </div>
          <p>
            {visibleDrafts.length} projet(s) affiché(s) sur {brouillons.length}.
          </p>
          {visibleDrafts.length === 0 ? (
            <p>Aucun projet ne correspond aux filtres.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 950, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                    <th style={{ padding: 9 }}>Date</th>
                    <th style={{ padding: 9 }}>Client / chantier</th>
                    <th style={{ padding: 9 }}>Devis</th>
                    <th style={{ padding: 9 }}>Intitulé / type</th>
                    <th style={{ padding: 9 }}>Statut</th>
                    <th style={{ padding: 9, textAlign: "right" }}>HT</th>
                    <th style={{ padding: 9, textAlign: "right" }}>TTC</th>
                    <th style={{ padding: 9 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDrafts.map((d) => (
                    <tr key={d.id} style={{ borderBottom: "1px solid #e9e5ef" }}>
                      <td style={{ padding: 9, whiteSpace: "nowrap" }}>
                        {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td style={{ padding: 9 }}>
                        <strong>{d.clientName}</strong>
                        <div>{d.affairName}</div>
                      </td>
                      <td style={{ padding: 9 }}>{d.quoteLabel}</td>
                      <td style={{ padding: 9 }}>
                        <strong>{d.label}</strong>
                        <div>{options.find((option) => option.value === d.type)?.label}</div>
                      </td>
                      <td style={{ padding: 9 }}>
                        {d.status === "APPROVED" ? "Validé en interne" : "Projet"}
                        <div style={{ fontSize: 11 }}>Non émis</div>
                      </td>
                      <td style={{ padding: 9, textAlign: "right", whiteSpace: "nowrap" }}>
                        {money(d.amountHtCents)}
                      </td>
                      <td style={{ padding: 9, textAlign: "right", whiteSpace: "nowrap" }}>
                        {money(d.totalTtcCents)}
                      </td>
                      <td style={{ padding: 9 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <Link
                            href={`/facturation/${encodeURIComponent(d.id)}`}
                            className="secondaryButton"
                          >
                            {d.status === "APPROVED" ? "Consulter" : "Ouvrir"}
                          </Link>
                          {donnees.canWrite && d.status === "DRAFT" ? (
                            <button
                              type="button"
                              className="secondaryButton"
                              disabled={busy}
                              onClick={() => {
                                if (confirm("Supprimer ce projet non émis ?"))
                                  void write(
                                    {
                                      action: "DELETE",
                                      draftId: d.id,
                                      expectedUpdatedAt: d.updatedAt,
                                    },
                                    "Projet supprimé",
                                  );
                              }}
                            >
                              Supprimer
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
