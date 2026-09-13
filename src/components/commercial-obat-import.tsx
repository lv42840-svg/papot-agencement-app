"use client";

import { CheckCircle2, FileText, RefreshCw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isCommercialClosed,
  type CommercialCase,
  type CommercialPayload,
} from "@/lib/commercial/domain";
import { obatKindForFile, requestObatAnalysis } from "@/lib/obat/client";
import type { ObatImportAnalysis } from "@/lib/obat/domain";

type CommercialSnapshot = {
  payload: CommercialPayload;
  focusCaseId?: string;
};

type TargetMode = "create" | "existing";

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day, 12),
  );
}

async function postCommercial(body: Record<string, unknown>): Promise<CommercialSnapshot> {
  const response = await fetch("/api/desktop/commercial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as CommercialSnapshot & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "COMMERCIAL_MUTATION_FAILED");
  return result;
}

async function uploadCommercialFiles(
  caseId: string,
  files: File[],
  analysis: ObatImportAnalysis,
): Promise<void> {
  for (const kind of ["QUOTE", "COSTING"] as const) {
    const selected = files.filter((file) => obatKindForFile(file, analysis) === kind);
    if (selected.length === 0) continue;
    const form = new FormData();
    selected.forEach((file) => form.append("files", file));
    form.set("category", kind);
    form.set("versionLabel", analysis.quoteNumber ?? "");
    form.set("variantLabel", "");
    form.set("isCurrent", "1");
    form.set("isSignedQuote", "0");
    const response = await fetch(`/api/desktop/commercial/${caseId}/documents`, {
      method: "POST",
      body: form,
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "COMMERCIAL_DOCUMENT_UPLOAD_FAILED");
  }
}

export function CommercialObatImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<ObatImportAnalysis | null>(null);
  const [commercial, setCommercial] = useState<CommercialPayload | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>("create");
  const [targetCaseId, setTargetCaseId] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [contactName, setContactName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/desktop/commercial", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as CommercialSnapshot;
        if (response.ok) setCommercial(result.payload);
      })
      .catch(() => undefined);
  }, [open]);

  const existingCases = useMemo(
    () => (commercial?.cases ?? []).filter((item) => !isCommercialClosed(item)),
    [commercial],
  );
  const targetCase = existingCases.find((item) => item.id === targetCaseId) ?? null;

  async function analyze(nextFiles: File[]) {
    if (nextFiles.length === 0) return;
    setFiles(nextFiles);
    setBusy(true);
    setError(null);
    try {
      const result = await requestObatAnalysis(nextFiles);
      setAnalysis(result);
      setName(result.projectName ?? result.clientName ?? (result.quoteNumber ? `Devis ${result.quoteNumber}` : ""));
      setClientName(result.clientName ?? "");
      setSiteLabel(result.projectName ?? result.siteAddress ?? "");
      setContactName(result.contactName ?? "");
      setDescription(result.description ?? result.projectName ?? "");
    } catch (analysisError) {
      setAnalysis(null);
      setError(analysisError instanceof Error ? analysisError.message : "L'analyse OBAT a échoué.");
    } finally {
      setBusy(false);
    }
  }

  function loadExisting(item: CommercialCase | null) {
    if (!item) return;
    setName(analysis?.projectName ?? item.name);
    setClientName(analysis?.clientName ?? item.clientName ?? "");
    setSiteLabel(analysis?.projectName ?? item.siteLabel ?? "");
    setContactName(analysis?.contactName ?? item.contactName ?? "");
    setDescription(analysis?.description ?? item.description ?? "");
  }

  async function applyImport() {
    if (!analysis) return;
    if (targetMode === "create" && (!name.trim() || !reviewDate)) return;
    if (targetMode === "existing" && !targetCase) return;
    setBusy(true);
    setError(null);

    try {
      let caseId: string;
      let current: CommercialCase | null = targetCase;

      if (targetMode === "create") {
        const created = await postCommercial({
          action: "create",
          name,
          clientName,
          siteLabel,
          reviewDate,
          description,
          nextAction: "",
        });
        caseId = created.focusCaseId ?? "";
        if (!caseId) throw new Error("COMMERCIAL_IMPORT_CREATE_FAILED");
        current = created.payload.cases.find((item) => item.id === caseId) ?? null;
      } else {
        caseId = targetCase?.id ?? "";
      }

      if (!current) {
        const response = await fetch("/api/desktop/commercial", { cache: "no-store" });
        const snapshot = (await response.json()) as CommercialSnapshot;
        current = snapshot.payload.cases.find((item) => item.id === caseId) ?? null;
      }
      if (!current) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

      const detailed = await postCommercial({
        action: "updateDetails",
        caseId,
        name: name.trim() || current.name,
        clientName: clientName.trim() || current.clientName || "",
        siteLabel: siteLabel.trim() || current.siteLabel || "",
        contactName: contactName.trim() || current.contactName || "",
        contactPhone: current.contactPhone || "",
        contactEmail: current.contactEmail || "",
        description: description.trim() || current.description || "",
        nextAction: current.nextAction || "",
      });
      current = detailed.payload.cases.find((item) => item.id === caseId) ?? current;

      const hasHours =
        analysis.hours.be !== null ||
        analysis.hours.workshop !== null ||
        analysis.hours.install !== null;
      if (hasHours) {
        await postCommercial({
          action: "updateProvision",
          caseId,
          be: analysis.hours.be ?? current.provisionHours.be,
          workshop: analysis.hours.workshop ?? current.provisionHours.workshop,
          install: analysis.hours.install ?? current.provisionHours.install,
        });
      }

      await uploadCommercialFiles(caseId, files, analysis);
      window.location.href = `/commercial?focus=${caseId}`;
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? `Import non terminé : ${applyError.message}`
          : "L'import OBAT n'a pas pu être enregistré.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`obatCommercial${open ? " isOpen" : ""}`}>
      <button type="button" className="obatCommercialToggle" onClick={() => setOpen((value) => !value)}>
        <Upload size={15} />
        <span>Importer devis / bordereau OBAT</span>
        <small>PDF + CSV → champs et heures préremplis</small>
      </button>

      {open ? (
        <div className="obatCommercialBody">
          <div className="obatCommercialTop">
            <div>
              <strong>Import intelligent OBAT</strong>
              <span>Dépose le devis PDF, le bordereau CSV, ou les deux. PAPOT te montre ce qu&apos;il a trouvé avant d&apos;enregistrer.</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer"><X size={15} /></button>
          </div>

          <input
            ref={inputRef}
            hidden
            type="file"
            multiple
            accept=".pdf,.csv,application/pdf,text/csv"
            onChange={(event) => {
              const next = Array.from(event.target.files ?? []);
              event.currentTarget.value = "";
              void analyze(next);
            }}
          />

          <button
            type="button"
            className="obatDropZone"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void analyze(Array.from(event.dataTransfer.files));
            }}
          >
            {busy ? <RefreshCw className="obatSpin" size={18} /> : <FileText size={20} />}
            <strong>{files.length ? files.map((file) => file.name).join(" + ") : "Déposer ou choisir les documents OBAT"}</strong>
            <span>Le PDF est lu directement, sans OCR, et le CSV fournit notamment ÉTUDES / FABRICATION / POSE.</span>
          </button>

          {error ? <div className="obatCommercialError">{error}</div> : null}

          {analysis ? (
            <>
              <div className="obatDetected">
                <div><small>Devis</small><strong>{analysis.quoteNumber ?? "Non trouvé"}</strong></div>
                <div><small>Client</small><strong>{analysis.clientName ?? "Non trouvé"}</strong></div>
                <div><small>Chantier</small><strong>{analysis.projectName ?? "Non trouvé"}</strong></div>
                <div><small>Début prévu</small><strong>{formatDate(analysis.plannedStartDate)}</strong></div>
                <div><small>Total HT</small><strong>{formatMoney(analysis.totalNetHt)}</strong></div>
                <div><small>Total TTC</small><strong>{formatMoney(analysis.totalTtc)}</strong></div>
              </div>

              <div className="obatHoursResult">
                <span><small>BE</small><strong>{analysis.hours.be ?? "—"} h</strong></span>
                <span><small>Atelier</small><strong>{analysis.hours.workshop ?? "—"} h</strong></span>
                <span><small>Pose</small><strong>{analysis.hours.install ?? "—"} h</strong></span>
              </div>

              <div className="obatTargetModes">
                <button type="button" className={targetMode === "create" ? "isActive" : ""} onClick={() => setTargetMode("create")}>Créer une affaire</button>
                <button type="button" className={targetMode === "existing" ? "isActive" : ""} onClick={() => setTargetMode("existing")}>Compléter une affaire existante</button>
              </div>

              {targetMode === "existing" ? (
                <label className="obatField obatWide">
                  <span>Affaire à compléter *</span>
                  <select value={targetCaseId} onChange={(event) => { setTargetCaseId(event.target.value); loadExisting(existingCases.find((item) => item.id === event.target.value) ?? null); }}>
                    <option value="">Choisir…</option>
                    {existingCases.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  </select>
                </label>
              ) : null}

              <div className="obatEditGrid">
                <label className="obatField"><span>Nom affaire *</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label className="obatField"><span>Client</span><input value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
                <label className="obatField"><span>Lieu / chantier</span><input value={siteLabel} onChange={(event) => setSiteLabel(event.target.value)} /></label>
                <label className="obatField"><span>Contact</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
                {targetMode === "create" ? <label className="obatField"><span>Prochaine revue * <em>non présente dans OBAT</em></span><input type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></label> : null}
                <label className="obatField obatWide"><span>Description</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
              </div>

              <div className="obatExtraInfo">
                {analysis.contactName ? <span>Contact détecté : <strong>{analysis.contactName}</strong></span> : null}
                {analysis.clientAddress ? <span>Adresse : <strong>{analysis.clientAddress}</strong></span> : null}
                {analysis.clientSiren ? <span>SIREN : <strong>{analysis.clientSiren}</strong></span> : null}
                {analysis.quoteDate ? <span>Devis du <strong>{formatDate(analysis.quoteDate)}</strong></span> : null}
                {analysis.validUntil ? <span>Valable jusqu&apos;au <strong>{formatDate(analysis.validUntil)}</strong></span> : null}
                {analysis.plannedEndDate ? <span>Fin prévue <strong>{formatDate(analysis.plannedEndDate)}</strong></span> : null}
              </div>

              {analysis.warnings.length ? <div className="obatWarnings">{analysis.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}

              <button
                type="button"
                className="primaryButton obatApply"
                disabled={busy || !name.trim() || (targetMode === "create" ? !reviewDate : !targetCaseId)}
                onClick={() => void applyImport()}
              >
                <CheckCircle2 size={15} />
                {targetMode === "create" ? "Créer et classer les documents" : "Compléter et classer les documents"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <style jsx global>{`
        .obatCommercial{margin-bottom:12px;border:1px solid #ddd4f4;border-radius:11px;background:#fff;overflow:hidden}.obatCommercialToggle{width:100%;min-height:48px;padding:9px 13px;display:grid;grid-template-columns:24px auto 1fr;align-items:center;gap:7px;border:0;background:linear-gradient(90deg,#f7f3ff,#fff);color:#5f4fc1;text-align:left}.obatCommercialToggle span{font-size:11px;font-weight:850}.obatCommercialToggle small{justify-self:end;color:#8a8297;font-size:8.5px;font-weight:600}.obatCommercialBody{padding:13px;display:grid;gap:11px;border-top:1px solid #eee9f7}.obatCommercialTop{display:flex;justify-content:space-between;gap:12px}.obatCommercialTop>div{display:grid;gap:2px}.obatCommercialTop strong{font-size:12px}.obatCommercialTop span{color:#817a8a;font-size:9px}.obatCommercialTop>button{border:0;background:transparent;color:#80788d}.obatDropZone{min-height:86px;padding:14px;display:grid;place-items:center;align-content:center;gap:4px;border:1px dashed #ad9be7;border-radius:10px;background:#faf8ff;color:#6653c7;text-align:center}.obatDropZone strong{font-size:10px}.obatDropZone span{max-width:760px;color:#8a8294;font-size:8.5px}.obatCommercialError{padding:9px 10px;border:1px solid #efc6bd;border-radius:8px;background:#fff5f3;color:#a34a3a;font-size:9px}.obatDetected{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}.obatDetected>div{padding:8px;display:grid;gap:2px;border:1px solid #ece7f2;border-radius:8px;background:#fff}.obatDetected small,.obatHoursResult small{color:#8b8592;font-size:7.5px;font-weight:750;text-transform:uppercase;letter-spacing:.04em}.obatDetected strong{overflow:hidden;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.obatHoursResult{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.obatHoursResult>span{padding:9px 11px;display:flex;align-items:center;justify-content:space-between;border:1px solid #d9d1ef;border-radius:8px;background:#f8f5ff}.obatHoursResult strong{font-size:12px;color:#5f4cc5}.obatTargetModes{display:flex;gap:5px}.obatTargetModes button{min-height:31px;padding:0 10px;border:1px solid #e0dae8;border-radius:7px;background:#fff;color:#716979;font-size:9px}.obatTargetModes button.isActive{border-color:#9f8ce6;background:#f2edff;color:#624fc4;font-weight:800}.obatEditGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.obatField{display:grid;gap:4px}.obatField>span{color:#615b68;font-size:8.5px;font-weight:750}.obatField em{color:#a06c36;font-size:7px;font-style:normal;font-weight:600}.obatField input,.obatField select,.obatField textarea{width:100%;padding:8px 9px;border:1px solid #dfdae6;border-radius:8px;background:#fff;font:inherit;font-size:9.5px}.obatWide{grid-column:1/-1}.obatExtraInfo{display:flex;flex-wrap:wrap;gap:6px}.obatExtraInfo span{padding:5px 7px;border-radius:999px;background:#f4f1f7;color:#756d7e;font-size:7.8px}.obatWarnings{display:grid;gap:3px;color:#9b693a;font-size:8px}.obatApply{width:max-content}.obatSpin{animation:obatSpin 1s linear infinite}@keyframes obatSpin{to{transform:rotate(360deg)}}@media(max-width:1050px){.obatDetected{grid-template-columns:repeat(3,1fr)}}@media(max-width:720px){.obatCommercialToggle{grid-template-columns:24px 1fr}.obatCommercialToggle small{display:none}.obatDetected,.obatHoursResult,.obatEditGrid{grid-template-columns:1fr}.obatWide{grid-column:auto}}
      `}</style>
    </section>
  );
}
