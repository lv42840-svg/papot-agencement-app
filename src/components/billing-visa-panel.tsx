"use client";

import { useState } from "react";
import type { BillingDraft, BillingPayload, BillingVisaMethod } from "@/lib/billing/domain";
import { latestBillingVisa, visaRequiredForChantier } from "@/lib/billing/visa-policy";

const money = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const parseMoney = (value: string) => {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : NaN;
};

const statusLabels = {
  SUBMITTED: "En attente de visa",
  ACCEPTED: "Acceptée en totalité",
  PARTIAL: "Acceptation partielle",
  REFUSED: "Refusée",
  WITHDRAWN: "Présentation retirée",
} as const;

const methodLabels: Record<BillingVisaMethod, string> = {
  EMAIL: "E-mail",
  SIGNATURE: "Signature",
  MEETING: "Compte rendu / réunion",
  PHONE: "Téléphone (preuve faible)",
  OTHER: "Autre justificatif",
};

export function BillingVisaPanel({
  draft,
  payload,
  canWrite,
  dirty,
  onRefresh,
}: {
  draft: BillingDraft;
  payload: BillingPayload;
  canWrite: boolean;
  dirty: boolean;
  onRefresh: () => Promise<void>;
}) {
  const versions = (payload.visaVersions ?? []).filter((v) => v.draftId === draft.id);
  const latest = latestBillingVisa(payload, draft.id);
  const required = visaRequiredForChantier(payload, draft.chantierId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recipient, setRecipient] = useState("");
  const [presentationNotes, setPresentationNotes] = useState("");
  const [decision, setDecision] = useState<"ACCEPTED" | "PARTIAL" | "REFUSED">("ACCEPTED");
  const [acceptedAmount, setAcceptedAmount] = useState("");
  const [method, setMethod] = useState<BillingVisaMethod>("EMAIL");
  const [contact, setContact] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("");

  async function mutate(body: Record<string, unknown>, success: string) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Enregistrement impossible");
      await onRefresh();
      setNotice(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Opération impossible");
    } finally {
      setBusy(false);
    }
  }

  function submitVisa() {
    if (dirty || !recipient.trim()) {
      setError(
        "Enregistre le projet puis indique un destinataire avant de présenter la situation.",
      );
      return;
    }
    void mutate(
      {
        action: "PRESENT_VISA",
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        submittedTo: recipient.trim(),
        submittedNotes: presentationNotes.trim(),
      },
      "Version provisoire enregistrée et marquée présentée. Aucun e-mail n'a été envoyé.",
    );
  }

  function reviewVisa() {
    if (
      !latest ||
      latest.status !== "SUBMITTED" ||
      !contact.trim() ||
      !evidence.trim() ||
      !reason.trim()
    ) {
      setError("Renseigne l'interlocuteur, le justificatif et le motif de la décision.");
      return;
    }
    const partialHtCents = decision === "PARTIAL" ? parseMoney(acceptedAmount) : undefined;
    if (
      decision === "PARTIAL" &&
      (!Number.isSafeInteger(partialHtCents) ||
        partialHtCents! <= 0 ||
        partialHtCents! >= latest.amountHtCents)
    ) {
      setError("Le montant accepté doit être supérieur à zéro et inférieur au montant présenté.");
      return;
    }
    void mutate(
      {
        action: "REVIEW_VISA",
        draftId: draft.id,
        version: latest.version,
        decision,
        ...(partialHtCents !== undefined ? { acceptedHtCents: partialHtCents } : {}),
        reviewMethod: method,
        externalContact: contact.trim(),
        evidence: evidence.trim(),
        reason: reason.trim(),
      },
      decision === "PARTIAL"
        ? "Accord partiel enregistré. Corrige et présente une nouvelle version avant validation interne."
        : "Décision de visa et preuve enregistrées.",
    );
  }

  const canAct = canWrite && draft.status === "DRAFT" && !dirty && !busy;
  const pending = latest?.status === "SUBMITTED";

  return (
    <section className="invoiceCard" aria-label="Visa externe de la situation">
      <h2>Visa extérieur et versions provisoires</h2>
      <p>
        Ce suivi garde les versions présentées au client ou au maître d&apos;œuvre, sans émettre de
        facture légale. Une validation interne est distincte du visa extérieur.
      </p>
      {draft.chantierId && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={required}
            disabled={!canAct || versions.some((v) => v.status === "SUBMITTED")}
            onChange={(event) =>
              void mutate(
                {
                  action: "SET_VISA_REQUIREMENT",
                  chantierId: draft.chantierId,
                  required: event.target.checked,
                },
                event.target.checked
                  ? "Visa extérieur obligatoire pour ce chantier."
                  : "Visa extérieur facultatif pour ce chantier.",
              )
            }
          />
          Visa extérieur obligatoire avant validation interne
        </label>
      )}
      <p>
        Statut :{" "}
        <strong>{latest ? statusLabels[latest.status] : "Aucune version présentée"}</strong>
        {required ? " · visa obligatoire" : " · visa facultatif"}
      </p>
      {error && (
        <p role="alert" style={{ color: "#a52020" }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: "#216f46" }}>
          {notice}
        </p>
      )}

      {canWrite && draft.status === "DRAFT" && !pending && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <h3>Présenter une version provisoire V{versions.length + 1}</h3>
          <label>
            Destinataire / organisme de visa
            <input
              value={recipient}
              maxLength={240}
              placeholder="Ex. Maître d'œuvre, architecte, client"
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <label>
            Remarques de présentation
            <textarea
              value={presentationNotes}
              maxLength={2000}
              rows={2}
              onChange={(event) => setPresentationNotes(event.target.value)}
            />
          </label>
          <button type="button" className="secondaryButton" disabled={!canAct} onClick={submitVisa}>
            Enregistrer la présentation provisoire
          </button>
          <small>
            PAPOT enregistre l&apos;état du document et l&apos;historique. Aucun e-mail ni PDF
            officiel n&apos;est envoyé par cette action.
          </small>
        </div>
      )}

      {pending && canWrite && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <h3>Décision sur la version V{latest.version}</h3>
          <label>
            Résultat du visa
            <select
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="ACCEPTED">Accepté intégralement</option>
              <option value="PARTIAL">Accepté partiellement</option>
              <option value="REFUSED">Refusé</option>
            </select>
          </label>
          {decision === "PARTIAL" && (
            <label>
              Montant HT accepté (sur {money(latest.amountHtCents)} HT)
              <input
                value={acceptedAmount}
                inputMode="decimal"
                placeholder="Ex. 32000,00"
                onChange={(event) => setAcceptedAmount(event.target.value)}
              />
            </label>
          )}
          <label>
            Nature de la preuve
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as BillingVisaMethod)}
            >
              {Object.entries(methodLabels).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Interlocuteur ayant répondu
            <input
              value={contact}
              maxLength={240}
              onChange={(event) => setContact(event.target.value)}
            />
          </label>
          <label>
            Justificatif (référence du mail, CR, signature ou appel)
            <textarea
              value={evidence}
              maxLength={2000}
              rows={2}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </label>
          <label>
            Motif ou commentaire
            <textarea
              value={reason}
              maxLength={2000}
              rows={2}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button type="button" className="primaryButton" disabled={!canAct} onClick={reviewVisa}>
            Enregistrer la décision de visa
          </button>
          <label>
            Motif de retrait de la présentation
            <input
              value={withdrawalReason}
              maxLength={2000}
              onChange={(event) => setWithdrawalReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondaryButton"
            disabled={!canAct || !withdrawalReason.trim()}
            onClick={() =>
              void mutate(
                {
                  action: "WITHDRAW_VISA",
                  draftId: draft.id,
                  version: latest.version,
                  reason: withdrawalReason.trim(),
                },
                "Présentation retirée avec historique conservé.",
              )
            }
          >
            Retirer cette présentation
          </button>
          <p>
            Les modifications du brouillon sont bloquées tant que cette version attend une décision.
          </p>
        </div>
      )}

      <h3>Historique des présentations ({versions.length})</h3>
      {versions.length === 0 ? (
        <p>Aucune version provisoire enregistrée.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {[...versions].reverse().map((version) => (
            <details
              key={version.id}
              style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
            >
              <summary>
                V{version.version} · {statusLabels[version.status]} · {money(version.amountHtCents)}{" "}
                HT · {new Date(version.submittedAt).toLocaleDateString("fr-FR")}
              </summary>
              <p>
                Présentée à {version.submittedTo} par {version.submittedByName}.
                {version.submittedNotes ? ` Note : ${version.submittedNotes}` : ""}
              </p>
              {version.status !== "SUBMITTED" && (
                <p>
                  Décision : {version.reviewedByName} · {version.reason} ·{" "}
                  {version.acceptedHtCents !== null
                    ? `${money(version.acceptedHtCents)} HT acceptés`
                    : "Aucun montant accepté"}
                  {version.reviewMethod ? ` · ${methodLabels[version.reviewMethod]}` : ""}
                  {version.externalContact ? ` · ${version.externalContact}` : ""}
                  {version.evidence ? ` · ${version.evidence}` : ""}
                </p>
              )}
              <p>
                Instantané : {version.documentLabel}, {version.documentLines.length} lignes, total{" "}
                {money(version.totalTtcCents)} TTC.
              </p>
              <a
                className="secondaryButton"
                href={`/api/desktop/billing/${encodeURIComponent(draft.id)}/visa/${version.version}/pdf`}
                download
                style={{ display: "inline-block", marginBottom: 10 }}
              >
                Télécharger le PDF provisoire V{version.version}
              </a>
              <details>
                <summary>Voir les lignes de cette version</summary>
                <ul>
                  {version.documentLines.map((line) => (
                    <li key={line.id}>
                      {line.description} {line.origin === "TITLE" ? "(titre)" : ""}
                    </li>
                  ))}
                </ul>
              </details>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
