"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowDown, ArrowUp, Copy, FileText, Plus, Save, Trash2 } from "lucide-react";
import {
  buildInvoiceDocumentLines,
  calculateInvoiceDocumentTotals,
} from "@/lib/billing/document-lines";
import {
  DEFAULT_BILLING_TITLES,
  type BillingDocumentLine,
  type BillingDraft,
  type BillingPayload,
} from "@/lib/billing/domain";
import { calculateLineProgress, type LineProgressInput } from "@/lib/billing/progress";

type ApiSnapshot = { payload: BillingPayload; canWrite: boolean; error?: string };
type EditableRow = BillingDocumentLine & { quantityInput: string; priceInput: string };

const currency = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const decimal = (valeur: number) => String(valeur).replace(".", ",");
const euros = (valeur: number) => (valeur / 100).toFixed(2).replace(".", ",");
function centsFromEuros(valeur: string): number {
  const texte = valeur.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(texte)) return NaN;
  return Math.round(Number(texte) * 100);
}
function quantityFromText(valeur: string): number {
  const texte = valeur.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,4})?$/.test(texte) ? Number(texte) : NaN;
}
function editable(ligneTableau: BillingDocumentLine): EditableRow {
  return {
    ...ligneTableau,
    quantityInput: decimal(ligneTableau.quantity),
    priceInput: euros(ligneTableau.unitPriceCents),
  };
}
function serialize(ligneTableau: EditableRow): BillingDocumentLine | null {
  if (!ligneTableau.description.trim()) return null;
  const quantity =
    ligneTableau.origin === "TITLE" ? 0 : quantityFromText(ligneTableau.quantityInput);
  const unitPriceCents =
    ligneTableau.origin === "TITLE" ? 0 : centsFromEuros(ligneTableau.priceInput);
  if (
    !Number.isFinite(quantity) ||
    !Number.isSafeInteger(unitPriceCents) ||
    quantity < 0 ||
    unitPriceCents < 0 ||
    (ligneTableau.origin !== "TITLE" && quantity <= 0)
  )
    return null;
  return {
    id: ligneTableau.id,
    origin: ligneTableau.origin,
    sourceLineId: ligneTableau.sourceLineId,
    description: ligneTableau.description,
    quantity,
    unit: ligneTableau.unit,
    unitPriceCents,
    vatRatePercent: ligneTableau.vatRatePercent,
  };
}
const libelles: Record<BillingDraft["type"], string> = {
  STANDARD: "Facture classique",
  DEPOSIT: "Acompte",
  PROGRESS: "Situation",
  FINAL: "Solde",
};
const serverErrors: Record<string, string> = {
  BILLING_DRAFT_LOCKED: "Ce document est validé en interne et verrouillé.",
  BILLING_APPROVAL_TOTALS_MISMATCH:
    "Les totaux ne correspondent pas. Corrige puis enregistre avant validation.",
  BILLING_PROGRESS_DOCUMENT_MISMATCH:
    "Le montant de la facture ne correspond pas aux avancements par ligne.",
  BILLING_VERSION_CONFLICT:
    "Cette facture a été modifiée depuis l'ouverture. Recharge la page avant de poursuivre.",
  BILLING_DRAFT_HAS_DEPENDENTS:
    "Une facture plus récente dépend de ce projet : son montant ne peut plus changer.",
  BILLING_AMOUNT_EXCEEDS_CONTRACT:
    "Le total dépasse le restant du devis retenu. Un devis complémentaire validé est nécessaire.",
  BILLING_DOCUMENT_EMPTY: "Ajoute au moins une ligne avec un montant HT positif.",
  BILLING_DOCUMENT_DUPLICATE_LINE: "Des lignes sont dupliquées. Actualise puis réessaie.",
  BILLING_DOCUMENT_VAT_OUTSIDE_CONTRACT:
    "Le taux de TVA doit correspondre à un taux du devis retenu.",
  BILLING_DOCUMENT_SOURCE_LINE_INVALID: "La référence à une ligne du devis est incorrecte.",
  BILLING_PROGRESS_CANNOT_DECREASE:
    "Un avancement ne peut pas être inférieur à la situation précédente.",
  BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE:
    "La TVA est incompatible avec les acomptes déjà préparés.",
};

export function BillingDocumentEditor({ draftId: idBrouillon }: { draftId: string }) {
  const router = useRouter();
  const [brouillon, setDraft] = useState<BillingDraft | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [lignesTableau, setRows] = useState<EditableRow[]>([]);
  const [initialRows, setInitialRows] = useState<EditableRow[]>([]);
  const [contenu, setPayload] = useState<BillingPayload | null>(null);
  const [progressValues, setProgressValues] = useState<Record<string, string>>({});
  const [pendingPercentages, setPendingPercentages] = useState<LineProgressInput[] | null>(null);
  const [libelle, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [chargement, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [erreur, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const reponse = await fetch("/api/desktop/billing", { cache: "no-store" });
    const json = (await reponse.json()) as ApiSnapshot;
    if (!reponse.ok) throw new Error(json.error ?? "Impossible de charger la facture");
    const selectionne = json.payload.drafts.find((element) => element.id === idBrouillon);
    if (!selectionne) throw new Error("Projet de facture introuvable");
    setDraft(selectionne);
    setPayload(json.payload);
    setCanWrite(json.canWrite && selectionne.status === "DRAFT");
    setProgressValues(
      Object.fromEntries(
        (selectionne.lines ?? []).map((ligne) => [
          ligne.lineId,
          decimal(
            selectionne.lineProgress?.find((ligneTableau) => ligneTableau.lineId === ligne.lineId)
              ?.percent ??
              selectionne.cumulativePercent ??
              0,
          ),
        ]),
      ),
    );
    setPendingPercentages(null);
    setLabel(selectionne.label);
    setNotes(selectionne.notes);
    const original = (
      selectionne.documentLines ?? buildInvoiceDocumentLines(selectionne, json.payload)
    ).map(editable);
    setRows(original);
    setInitialRows(original);
    setDirty(false);
  }
  useEffect(() => {
    void reload()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Erreur de chargement"),
      )
      .finally(() => setLoading(false));
    // The draft ID is stable for this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idBrouillon]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (evenement: BeforeUnloadEvent) => {
      evenement.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parsedRows = useMemo(() => lignesTableau.map(serialize), [lignesTableau]);
  const invalid = parsedRows.some((ligneTableau) => ligneTableau === null);
  const apercu = useMemo(() => {
    if (invalid || parsedRows.length === 0) return null;
    try {
      return calculateInvoiceDocumentTotals(parsedRows as BillingDocumentLine[]);
    } catch {
      return null;
    }
  }, [parsedRows, invalid]);
  const rates = [
    ...new Set(brouillon?.contractTaxGroups.map((rate) => rate.ratePercent) ?? [20]),
  ].sort((a, b) => a - b);
  const titleChoices = contenu?.invoiceTitles ?? [...DEFAULT_BILLING_TITLES];
  const availableTitles = titleChoices.includes(libelle)
    ? titleChoices
    : [libelle, ...titleChoices];
  const priorProjects =
    brouillon && contenu
      ? contenu.drafts
          .slice(
            0,
            contenu.drafts.findIndex((element) => element.id === brouillon.id),
          )
          .filter((element) => element.quoteId === brouillon.quoteId)
      : [];
  const priorHt = priorProjects.reduce((somme, element) => somme + element.amountHtCents, 0);

  function alter(id: string, patch: Partial<EditableRow>) {
    setRows((old) =>
      old.map((ligneTableau) =>
        ligneTableau.id === id ? { ...ligneTableau, ...patch } : ligneTableau,
      ),
    );
    setDirty(true);
    setNotice("");
  }
  function reorder(indice: number, direction: number) {
    const other = indice + direction;
    if (other < 0 || other >= lignesTableau.length) return;
    setRows((old) => {
      const resultat = [...old];
      [resultat[indice], resultat[other]] = [resultat[other], resultat[indice]];
      return resultat;
    });
    setDirty(true);
    setNotice("");
  }
  function addLine(kind: "FREE" | "TITLE") {
    const ligneTableau: BillingDocumentLine = {
      id: crypto.randomUUID(),
      origin: kind,
      sourceLineId: null,
      description: kind === "TITLE" ? "Nouveau titre" : "Prestation complémentaire",
      quantity: kind === "TITLE" ? 0 : 1,
      unit: kind === "TITLE" ? "" : "u",
      unitPriceCents: 0,
      vatRatePercent: kind === "TITLE" ? 0 : (rates[0] ?? 20),
    };
    setRows((old) => [...old, editable(ligneTableau)]);
    setDirty(true);
    setNotice("");
  }
  function duplicate(ligneTableau: EditableRow, indice: number) {
    if (ligneTableau.origin === "TITLE") return;
    const copy: EditableRow = {
      ...ligneTableau,
      id: crypto.randomUUID(),
      origin: "FREE",
      sourceLineId: null,
      description: `${ligneTableau.description} (copie)`,
    };
    setRows((old) => [...old.slice(0, indice + 1), copy, ...old.slice(indice + 1)]);
    setDirty(true);
    setNotice("");
  }
  function remove(id: string) {
    setRows((old) => old.filter((ligneTableau) => ligneTableau.id !== id));
    setDirty(true);
    setNotice("");
  }
  function applyProgress() {
    if (!brouillon || !contenu || brouillon.type !== "PROGRESS" || !brouillon.lines?.length) return;
    const percentages = brouillon.lines.map((ligne) => ({
      lineId: ligne.lineId,
      percent: Number((progressValues[ligne.lineId] ?? "").replace(",", ".")),
    }));
    if (
      percentages.some(
        (ligneTableau) =>
          !Number.isFinite(ligneTableau.percent) ||
          ligneTableau.percent < 0 ||
          ligneTableau.percent > 100,
      )
    ) {
      setError("L'avancement de chaque ligne doit être compris entre 0 et 100 %.");
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "Recalculer les lignes du devis ? Les lignes ajoutées restent, mais les prix modifiés sur les lignes du devis seront recalculés.",
      )
    )
      return;
    try {
      const indice = contenu.drafts.findIndex((ligneTableau) => ligneTableau.id === brouillon.id);
      const precedent = { schemaVersion: 1 as const, drafts: contenu.drafts.slice(0, indice) };
      const resultat = calculateLineProgress(precedent, brouillon, percentages);
      const recalculated: BillingDraft = {
        ...brouillon,
        lineProgress: resultat.lineProgress,
        cumulativePercent: null,
        amountHtCents: resultat.amountHtCents,
        taxGroups: resultat.tax.groups,
        vatCents: resultat.tax.vatCents,
        totalTtcCents: resultat.tax.ttcCents,
      };
      const custom = lignesTableau.filter((ligneTableau) => ligneTableau.origin !== "QUOTE");
      setRows([...buildInvoiceDocumentLines(recalculated, precedent).map(editable), ...custom]);
      setPendingPercentages(percentages);
      setDirty(true);
      setError("");
      setNotice("");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(serverErrors[code] ?? code ?? "Avancement invalide");
    }
  }
  function goBack() {
    if (dirty && !window.confirm("Des modifications ne sont pas enregistrées. Quitter ?")) return;
    router.push(
      brouillon?.chantierId
        ? `/facturation?chantierId=${encodeURIComponent(brouillon.chantierId)}`
        : `/facturation?quoteId=${encodeURIComponent(brouillon?.quoteId ?? "")}`,
    );
  }
  async function save() {
    if (!brouillon || !canWrite || busy) return;
    setError("");
    setNotice("");
    if (!libelle.trim() || invalid || !apercu || !parsedRows.length) {
      setError("Renseigne les désignations, quantités et prix de chaque ligne.");
      return;
    }
    const precedent = brouillon.amountHtCents;
    const exceeds = apercu.amountHtCents > brouillon.contractHtCents;
    if (exceeds) {
      setError("Ce projet dépasse le devis retenu. Crée un devis complémentaire validé.");
      return;
    }
    setBusy(true);
    try {
      const reponse = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_DOCUMENT",
          draftId: brouillon.id,
          expectedUpdatedAt: brouillon.updatedAt,
          label: libelle.trim(),
          notes,
          documentLines: parsedRows,
          ...(pendingPercentages ? { linePercentages: pendingPercentages } : {}),
        }),
      });
      const json = (await reponse.json()) as ApiSnapshot;
      if (!reponse.ok) throw new Error(json.error ?? "Enregistrement impossible");
      const saved = json.payload.drafts.find((element) => element.id === brouillon.id);
      if (!saved) throw new Error("Projet introuvable après enregistrement");
      setDraft(saved);
      setPayload(json.payload);
      setPendingPercentages(null);
      setProgressValues(
        Object.fromEntries(
          (saved.lines ?? []).map((ligne) => [
            ligne.lineId,
            decimal(
              saved.lineProgress?.find((ligneTableau) => ligneTableau.lineId === ligne.lineId)
                ?.percent ??
                saved.cumulativePercent ??
                0,
            ),
          ]),
        ),
      );
      const original = (saved.documentLines ?? []).map(editable);
      setRows(original);
      setInitialRows(original);
      setDirty(false);
      setNotice(
        apercu.amountHtCents !== precedent
          ? "Projet enregistré et totaux recalculés. Aucune facture officielle émise."
          : "Modifications enregistrées. Aucune facture officielle émise.",
      );
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(serverErrors[code] ?? code ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!brouillon || !canWrite || busy || dirty) return;
    if (
      !window.confirm(
        "Valider et verrouiller ce projet en interne ? Il ne pourra plus être modifié. Aucun numéro légal ni facture officielle ne sera émis.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const reponse = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPROVE",
          draftId: brouillon.id,
          expectedUpdatedAt: brouillon.updatedAt,
        }),
      });
      const resultat = (await reponse.json()) as ApiSnapshot;
      if (!reponse.ok) throw new Error(resultat.error ?? "Validation impossible");
      await reload();
      setNotice("Projet approuvé et verrouillé en interne. Aucune facture officielle émise.");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(serverErrors[code] ?? code ?? "Validation impossible");
    } finally {
      setBusy(false);
    }
  }

  if (chargement) return <main className="invoiceLoading">Chargement du projet de facture…</main>;
  if (!brouillon)
    return (
      <main className="invoiceLoading" role="alert">
        {erreur || "Facture introuvable."}
      </main>
    );

  return (
    <div className="invoiceEditor">
      <header className="invoiceHeading">
        <div className="invoiceIdentity">
          <button type="button" className="secondaryButton" onClick={goBack}>
            <ArrowLeft size={15} /> Retour aux projets
          </button>
          <span className="invoiceTag">
            {brouillon.status === "APPROVED" ? "VALIDÉ EN INTERNE · NON ÉMIS" : "PROJET · NON ÉMIS"}
          </span>
          <h1>
            <FileText size={25} /> {libelles[brouillon.type]}
          </h1>
          <p>
            {brouillon.affairName} · {brouillon.clientName}
          </p>
          <div className="invoiceReferences">
            <Link href={`/devis/${brouillon.quoteId}`}>Devis source : {brouillon.quoteLabel}</Link>
            {brouillon.chantierId && (
              <Link href={`/chantiers/${brouillon.chantierId}`}>Ouvrir le chantier</Link>
            )}
          </div>
        </div>
        <div className="invoiceHeadingActions">
          {dirty && <span className="invoiceModified">Modifications non enregistrées</span>}
          <button
            type="button"
            className="primaryButton"
            disabled={!canWrite || busy || !dirty}
            onClick={() => void save()}
          >
            <Save size={16} /> {busy ? "Enregistrement…" : "Enregistrer le projet"}
          </button>
        </div>
      </header>

      <aside className="invoiceDraftNotice">
        Tu modifies une <strong>copie des lignes du devis</strong>, uniquement pour cette facture.
        Le devis signé reste inchangé. Ce projet n&apos;a ni numéro officiel, ni PDF émis, ni envoi
        Pennylane.
      </aside>
      {erreur && (
        <p className="invoiceError" role="alert">
          {erreur}
        </p>
      )}
      {notice && (
        <p className="invoiceSuccess" role="status">
          {notice}
        </p>
      )}
      {!canWrite && (
        <p className="invoiceDraftNotice">
          {brouillon.status === "APPROVED"
            ? "Projet verrouillé après validation interne."
            : "Lecture seule : droit Facturation en écriture requis."}
        </p>
      )}

      <section className="invoiceCard">
        <h2>Informations de la facture</h2>
        <div className="invoiceMeta">
          <label>
            Intitulé de la facture
            <select
              value={libelle}
              disabled={!canWrite}
              onChange={(e) => {
                setLabel(e.target.value);
                setDirty(true);
              }}
            >
              {availableTitles.map((element) => (
                <option key={element} value={element}>
                  {element}
                </option>
              ))}
            </select>
            <Link href="/settings/billing" style={{ fontSize: 12 }}>
              Gérer les intitulés dans Paramètres
            </Link>
          </label>
          <label>
            Observations / conditions
            <textarea
              rows={2}
              value={notes}
              disabled={!canWrite}
              maxLength={4000}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
            />
          </label>
        </div>
      </section>

      <section className="invoiceCard">
        <h2>Déjà préparé sur ce devis</h2>
        <p>
          Ces montants correspondent aux projets antérieurs, acomptes et situations inclus. Ce ne
          sont pas des factures officiellement émises.
        </p>
        {priorProjects.length === 0 ? (
          <p>Aucun acompte ni situation précédemment préparé sur ce devis.</p>
        ) : (
          <div className="invoiceScroll">
            <table className="invoiceTable">
              <thead>
                <tr>
                  <th>Projet précédent</th>
                  <th>Date</th>
                  <th>Statut</th>
                  <th>HT</th>
                  <th>TVA</th>
                  <th>TTC</th>
                </tr>
              </thead>
              <tbody>
                {priorProjects.map((element) => (
                  <tr key={element.id}>
                    <td>
                      <Link href={`/facturation/${element.id}`}>
                        {libelles[element.type]} · {element.label}
                      </Link>
                    </td>
                    <td>{new Date(element.createdAt).toLocaleDateString("fr-FR")}</td>
                    <td>
                      {element.status === "APPROVED" ? "Validé en interne" : "Projet non validé"}
                    </td>
                    <td>{currency(element.amountHtCents)}</td>
                    <td>{currency(element.vatCents)}</td>
                    <td>{currency(element.totalTtcCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          <strong>Déjà préparé : {currency(priorHt)} HT</strong> · Projet actuel :{" "}
          {currency(apercu?.amountHtCents ?? brouillon.amountHtCents)} HT · Cumul après ce projet :{" "}
          {currency(priorHt + (apercu?.amountHtCents ?? brouillon.amountHtCents))} HT sur{" "}
          {currency(brouillon.contractHtCents)} HT.
        </p>
      </section>

      <section className="invoiceCard invoiceLines">
        <div className="invoiceCardHeader">
          <div>
            <h2>Détail des prestations</h2>
            <p>Modifie les lignes puis enregistre pour recalculer la facture.</p>
          </div>
          <div className="invoiceToolbar">
            <button
              className="secondaryButton"
              type="button"
              disabled={!canWrite || busy}
              onClick={() => addLine("TITLE")}
            >
              <Plus size={15} /> Titre
            </button>
            <button
              className="primaryButton"
              type="button"
              disabled={!canWrite || busy || lignesTableau.length >= 1000}
              onClick={() => addLine("FREE")}
            >
              <Plus size={15} /> Ajouter une ligne
            </button>
          </div>
        </div>
        <div className="invoiceScroll">
          <table className="invoiceTable">
            <thead>
              <tr>
                <th>N°</th>
                <th>Désignation</th>
                <th>Qté</th>
                <th>Unité</th>
                <th>Prix unit. HT</th>
                <th>TVA</th>
                <th>Total HT</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lignesTableau.map((ligneTableau, indice) => {
                const courant = parsedRows[indice];
                const montant = courant
                  ? Math.round(courant.quantity * courant.unitPriceCents)
                  : NaN;
                return (
                  <tr
                    key={ligneTableau.id}
                    className={ligneTableau.origin === "TITLE" ? "invoiceTitleRow" : ""}
                  >
                    <td className="invoiceIndex">{indice + 1}</td>
                    <td className="invoiceDescription">
                      <input
                        aria-label={`Désignation ligne ${indice + 1}`}
                        disabled={!canWrite}
                        value={ligneTableau.description}
                        onChange={(e) => alter(ligneTableau.id, { description: e.target.value })}
                      />
                      {ligneTableau.origin !== "TITLE" && (
                        <small>
                          {ligneTableau.origin === "QUOTE"
                            ? "Issu du devis"
                            : "Ligne ajoutée à cette facture"}
                        </small>
                      )}
                    </td>
                    {ligneTableau.origin === "TITLE" ? (
                      <td colSpan={5} className="invoiceTitleHint">
                        Titre libre, sans montant facturé
                      </td>
                    ) : (
                      <>
                        <td>
                          <input
                            aria-label={`Quantité ligne ${indice + 1}`}
                            inputMode="decimal"
                            disabled={!canWrite}
                            value={ligneTableau.quantityInput}
                            onChange={(e) =>
                              alter(ligneTableau.id, { quantityInput: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Unité ligne ${indice + 1}`}
                            disabled={!canWrite}
                            maxLength={40}
                            value={ligneTableau.unit}
                            onChange={(e) => alter(ligneTableau.id, { unit: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Prix unitaire HT ligne ${indice + 1}`}
                            inputMode="decimal"
                            disabled={!canWrite}
                            value={ligneTableau.priceInput}
                            onChange={(e) => alter(ligneTableau.id, { priceInput: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`TVA ligne ${indice + 1}`}
                            disabled={!canWrite}
                            value={ligneTableau.vatRatePercent}
                            onChange={(e) =>
                              alter(ligneTableau.id, { vatRatePercent: Number(e.target.value) })
                            }
                          >
                            {rates.map((rate) => (
                              <option key={rate} value={rate}>
                                {rate} %
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="invoiceLineSum">
                          {Number.isSafeInteger(montant) ? currency(montant) : "À vérifier"}
                        </td>
                      </>
                    )}
                    <td className="invoiceRowTools">
                      {canWrite && (
                        <>
                          <button
                            title="Monter"
                            aria-label={`Monter ligne ${indice + 1}`}
                            disabled={indice === 0}
                            onClick={() => reorder(indice, -1)}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            title="Descendre"
                            aria-label={`Descendre ligne ${indice + 1}`}
                            disabled={indice === lignesTableau.length - 1}
                            onClick={() => reorder(indice, 1)}
                          >
                            <ArrowDown size={14} />
                          </button>
                          {ligneTableau.origin !== "TITLE" && (
                            <button
                              title="Dupliquer"
                              aria-label={`Dupliquer ligne ${indice + 1}`}
                              onClick={() => duplicate(ligneTableau, indice)}
                            >
                              <Copy size={14} />
                            </button>
                          )}
                          <button
                            title="Supprimer"
                            aria-label={`Supprimer ligne ${indice + 1}`}
                            onClick={() => remove(ligneTableau.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {brouillon.type === "PROGRESS" && brouillon.lines?.length ? (
          <details className="invoiceProgress" open>
            <summary>Avancement cumulé par ligne du devis</summary>
            <p>
              Tu peux corriger les pourcentages de cette situation. Recalcule les lignes puis
              enregistre le projet. Les avancements antérieurs restent protégés.
            </p>
            <div className="invoiceScroll">
              <table className="invoiceTable">
                <thead>
                  <tr>
                    <th>Prestation du devis</th>
                    <th>Avancement cumulé (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {brouillon.lines.map((ligne) => (
                    <tr key={ligne.lineId}>
                      <td>{ligne.description}</td>
                      <td>
                        <input
                          aria-label={`Avancement cumulé de ${ligne.description}`}
                          inputMode="decimal"
                          disabled={!canWrite || busy}
                          value={progressValues[ligne.lineId] ?? "0"}
                          onChange={(evenement) =>
                            setProgressValues((old) => ({
                              ...old,
                              [ligne.lineId]: evenement.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="secondaryButton"
              disabled={!canWrite || busy}
              onClick={applyProgress}
            >
              Recalculer les lignes depuis les pourcentages
            </button>
            {pendingPercentages && <p>Avancements recalculés, enregistrement nécessaire.</p>}
          </details>
        ) : null}
        <p className="invoiceHint">
          Les lignes libres sont intégrées au plafond du devis retenu. Pour facturer des travaux
          supplémentaires dépassant le contrat, crée et fais valider un devis complémentaire.
        </p>
      </section>

      <section className="invoiceCard invoiceSummary">
        <h2>Synthèse du projet</h2>
        <div className="invoiceTotals">
          <div>
            <span>Montant HT</span>
            <strong>{apercu ? currency(apercu.amountHtCents) : "À vérifier"}</strong>
          </div>
          <div>
            <span>TVA</span>
            <strong>{apercu ? currency(apercu.vatCents) : "À vérifier"}</strong>
          </div>
          <div className="invoiceTtc">
            <span>Total TTC</span>
            <strong>{apercu ? currency(apercu.totalTtcCents) : "À vérifier"}</strong>
          </div>
        </div>
        <div className="invoiceTotals invoiceComparison">
          <div>
            <span>Contrat retenu HT</span>
            <strong>{currency(brouillon.contractHtCents)}</strong>
          </div>
          <div>
            <span>Montant initial du projet HT</span>
            <strong>{currency(brouillon.amountHtCents)}</strong>
          </div>
        </div>
        <div className="invoiceFooterActions">
          {brouillon.status === "DRAFT" && (
            <button
              className="secondaryButton"
              type="button"
              disabled={!canWrite || busy || dirty || !apercu}
              onClick={() => void approve()}
            >
              Valider en interne et verrouiller
            </button>
          )}
          <button
            className="secondaryButton"
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Abandonner les modifications non enregistrées ?"))
                return;
              setRows(initialRows.map((ligneTableau) => ({ ...ligneTableau })));
              setLabel(brouillon.label);
              setNotes(brouillon.notes);
              setProgressValues(
                Object.fromEntries(
                  (brouillon.lines ?? []).map((ligne) => [
                    ligne.lineId,
                    decimal(
                      brouillon.lineProgress?.find(
                        (ligneTableau) => ligneTableau.lineId === ligne.lineId,
                      )?.percent ??
                        brouillon.cumulativePercent ??
                        0,
                    ),
                  ]),
                ),
              );
              setPendingPercentages(null);
              setDirty(false);
              setError("");
            }}
          >
            Annuler les modifications
          </button>
          <button
            className="primaryButton"
            type="button"
            disabled={!canWrite || busy || !dirty || !apercu}
            onClick={() => void save()}
          >
            <Save size={16} /> Enregistrer le projet
          </button>
        </div>
      </section>
      <style jsx>{`
        .invoiceEditor {
          padding: 18px 22px 32px;
          max-width: 1500px;
          margin: auto;
          display: grid;
          gap: 16px;
          color: #302b3a;
        }
        .invoiceHeading {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .invoiceIdentity {
          display: grid;
          gap: 9px;
        }
        .invoiceIdentity h1 {
          display: flex;
          align-items: center;
          gap: 9px;
          margin: 2px 0 0;
          font-size: 25px;
        }
        .invoiceIdentity p {
          font-size: 13px;
          color: #726c7d;
          margin: 0;
        }
        .invoiceReferences {
          display: flex;
          gap: 16px;
          font-size: 12px;
        }
        .invoiceReferences :global(a) {
          color: #5740a4;
          text-decoration: underline;
        }
        .invoiceHeadingActions {
          display: flex;
          gap: 13px;
          align-items: center;
          flex-wrap: wrap;
        }
        .invoiceTag {
          background: #fff5d9;
          color: #735000;
          font-size: 11px;
          font-weight: 700;
          border-radius: 6px;
          padding: 5px 8px;
          width: fit-content;
        }
        .invoiceModified {
          color: #8b6113;
          font-size: 12px;
        }
        .invoiceDraftNotice {
          background: #fff8e9;
          padding: 13px;
          border: 1px solid #ead9b0;
          border-radius: 8px;
          font-size: 12px;
        }
        .invoiceError,
        .invoiceSuccess {
          padding: 12px 14px;
          border-radius: 8px;
          font-size: 13px;
          margin: 0;
        }
        .invoiceError {
          background: #fff0f0;
          color: #9e2727;
        }
        .invoiceSuccess {
          background: #edf8ed;
          color: #286d41;
        }
        .invoiceCard {
          background: white;
          border: 1px solid #e5e1eb;
          border-radius: 12px;
          padding: 18px;
          display: grid;
          gap: 13px;
          min-width: 0;
        }
        .invoiceCard h2 {
          margin: 0;
          font-size: 18px;
        }
        .invoiceMeta {
          display: grid;
          grid-template-columns: 1fr 1.6fr;
          gap: 16px;
        }
        .invoiceMeta label {
          display: grid;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
        }
        .invoiceMeta input,
        .invoiceMeta select,
        .invoiceMeta textarea {
          border: 1px solid #ded9e5;
          border-radius: 7px;
          padding: 10px;
          width: 100%;
          background: #fff;
          color: #2b2735;
        }
        .invoiceCardHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 15px;
          flex-wrap: wrap;
        }
        .invoiceCardHeader p {
          color: #716b79;
          font-size: 12px;
          margin: 4px 0;
        }
        .invoiceToolbar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .invoiceScroll {
          max-width: 100%;
          overflow-x: auto;
        }
        .invoiceTable {
          border-collapse: collapse;
          width: 100%;
          min-width: 970px;
          font-size: 12px;
        }
        .invoiceTable th {
          text-align: left;
          color: #5c5666;
          font-weight: 600;
          font-size: 11px;
          background: #f7f5f9;
          padding: 10px 7px;
          border-bottom: 1px solid #e7e2ea;
        }
        .invoiceTable td {
          border-bottom: 1px solid #efecf2;
          vertical-align: top;
          padding: 7px;
        }
        .invoiceTable input,
        .invoiceTable select {
          width: 100%;
          min-width: 67px;
          border: 1px solid #dcd8e2;
          border-radius: 6px;
          background: #fff;
          padding: 8px;
          color: #292532;
        }
        .invoiceIndex {
          width: 35px;
          color: #9e96a4;
          padding-top: 15px !important;
        }
        .invoiceDescription {
          min-width: 280px;
        }
        .invoiceDescription small {
          display: block;
          color: #77717e;
          margin-top: 4px;
          font-size: 10px;
        }
        .invoiceLineSum {
          text-align: right;
          white-space: nowrap;
          font-weight: 650;
          padding-top: 16px !important;
        }
        .invoiceTitleRow {
          background: #f5f1f9;
        }
        .invoiceTitleRow input {
          font-weight: 700;
        }
        .invoiceTitleHint {
          color: #8a8390;
          padding-top: 15px !important;
        }
        .invoiceRowTools {
          white-space: nowrap;
        }
        .invoiceRowTools button {
          background: transparent;
          border: 1px solid #e6e1e9;
          border-radius: 6px;
          margin: 1px;
          padding: 5px;
          cursor: pointer;
        }
        .invoiceRowTools button:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .invoiceProgress {
          border-top: 1px solid #eee;
          padding-top: 12px;
          font-size: 12px;
        }
        .invoiceProgress summary {
          cursor: pointer;
          font-weight: 600;
        }
        .invoiceHint {
          margin: 0;
          color: #766b7b;
          font-size: 12px;
        }
        .invoiceTotals {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .invoiceTotals > div {
          display: grid;
          gap: 8px;
          padding: 12px;
          background: #f8f6fa;
          border-radius: 8px;
        }
        .invoiceTotals span {
          font-size: 11px;
          color: #746b7b;
        }
        .invoiceTotals strong {
          font-size: 18px;
        }
        .invoiceTtc {
          background: #eee7f9 !important;
          color: #392969;
        }
        .invoiceComparison {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .invoiceComparison strong {
          font-size: 14px;
        }
        .invoiceFooterActions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .invoiceEditor :global(.primaryButton),
        .invoiceEditor :global(.secondaryButton) {
          display: inline-flex;
          gap: 7px;
          align-items: center;
        }
        @media (max-width: 750px) {
          .invoiceEditor {
            padding: 12px;
          }
          .invoiceMeta,
          .invoiceTotals {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
