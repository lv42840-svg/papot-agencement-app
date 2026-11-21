"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { previewNativeCreditNote } from "@/lib/billing/native-credit-preview";

type TestInvoice = {
  id: string;
  draftId: string;
  number: string;
  issuedOn: string;
  totalTtcCents: number;
  remainingTtcCents: number;
  clientName: string;
  remainingHtByRate: Array<{
    ratePercent: number;
    remainingHtCents: number;
    remainingVatCents: number;
  }>;
};
type TestCredit = {
  id: string;
  number: string;
  originalInvoiceId: string;
  totalTtcCents: number;
  reason: string;
};
type SandboxSummary = {
  mode: "TEST_ONLY";
  invoices: TestInvoice[];
  credits: TestCredit[];
  resetCount: number;
  lastResetAt: string | null;
  lastResetByName: string | null;
};
type ApprovedDraft = {
  id: string;
  updatedAt: string;
  clientName: string;
  affairName: string;
  label: string;
  totalTtcCents: number;
};
type SandboxResponse = {
  sandbox: SandboxSummary;
  availableDrafts: ApprovedDraft[];
  canReset: boolean;
  error?: string;
};

const euros = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const date = () => new Date().toISOString().slice(0, 10);
export function BillingTestSandboxPanel() {
  const [data, setData] = useState<SandboxResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftId, setDraftId] = useState("");
  const [serviceOn, setServiceOn] = useState(date());
  const [dueOn, setDueOn] = useState("");
  const [operationCategory, setOperationCategory] = useState<"SERVICE" | "GOODS" | "MIXED">(
    "SERVICE",
  );
  const [vatOnDebits, setVatOnDebits] = useState(false);
  const [buyerPurchaseOrderNumber, setBuyerPurchaseOrderNumber] = useState("");
  const [latePenaltyRate, setLatePenaltyRate] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [creditMode, setCreditMode] = useState<"FULL" | "PARTIAL">("FULL");
  const [creditRate, setCreditRate] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const invoiceRequest = useRef<string | null>(null);
  const creditRequest = useRef<string | null>(null);

  async function load() {
    const response = await fetch("/api/desktop/billing/test-sandbox", { cache: "no-store" });
    const body = (await response.json()) as SandboxResponse;
    if (!response.ok) throw new Error(body.error ?? "Chargement des tests impossible.");
    setData(body);
  }
  useEffect(() => {
    void load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Chargement des tests impossible.");
    });
  }, []);

  async function mutate(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/desktop/billing/test-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Opération de test refusée.");
      await load();
      setNotice(success);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Opération de test refusée.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const drafts = data?.availableDrafts ?? [];
  const invoices = data?.sandbox.invoices ?? [];
  const credits = data?.sandbox.credits ?? [];
  const selectedDraft = drafts.find((item) => item.id === draftId) ?? drafts[0];
  const selectedInvoice = invoices.find((item) => item.id === invoiceId) ?? invoices[0];
  const availableRates = selectedInvoice?.remainingHtByRate ?? [];
  const selectedRate =
    availableRates.find((item) => String(item.ratePercent) === creditRate) ??
    availableRates.find((item) => item.remainingHtCents > 0);
  const creditPreview = useMemo(() => {
    if (!selectedInvoice) return null;
    const inputs =
      creditMode === "PARTIAL" && selectedRate
        ? { [String(selectedRate.ratePercent)]: creditAmount }
        : {};
    return previewNativeCreditNote(availableRates, creditMode, inputs);
  }, [selectedInvoice, availableRates, creditMode, selectedRate, creditAmount]);

  async function simulateInvoice() {
    if (!selectedDraft || !serviceOn || !dueOn || !latePenaltyRate.trim()) return;
    const rate = Number(latePenaltyRate.replace(",", "."));
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      setError("Indique le taux annuel des pénalités, de 0 à 100 %.");
      return;
    }
    const requestId = invoiceRequest.current ?? crypto.randomUUID();
    invoiceRequest.current = requestId;
    const success = await mutate(
      {
        action: "SIMULATE_INVOICE",
        input: {
          requestId,
          draftId: selectedDraft.id,
          expectedUpdatedAt: selectedDraft.updatedAt,
          serviceOn,
          dueOn,
          operationCategory,
          vatOnDebits,
          buyerPurchaseOrderNumber: buyerPurchaseOrderNumber.trim(),
          latePenaltyRatePercent: rate,
        },
      },
      "Facture fictive créée. Son numéro et son PDF sont strictement des simulations.",
    );
    if (success) invoiceRequest.current = null;
  }

  async function simulateCredit() {
    if (!selectedInvoice || !creditPreview?.valid || creditReason.trim().length < 3) return;
    const requestId = creditRequest.current ?? crypto.randomUUID();
    creditRequest.current = requestId;
    const success = await mutate(
      {
        action: "SIMULATE_CREDIT",
        input: {
          requestId,
          originalInvoiceId: selectedInvoice.id,
          mode: creditMode,
          reason: creditReason.trim(),
          amounts: creditPreview.amounts,
        },
      },
      "Avoir fictif créé et lié à la facture TEST.",
    );
    if (success) {
      creditRequest.current = null;
      setCreditReason("");
      setCreditAmount("");
    }
  }

  async function resetSandbox() {
    if (!data?.canReset || resetConfirmation !== "EFFACER LES ESSAIS") return;
    if (
      !window.confirm(
        "Supprimer UNIQUEMENT les factures et avoirs simulés et remettre leurs compteurs de test à zéro ? " +
          "Les factures officielles, leurs numéros, les projets et Pennylane ne seront pas modifiés.",
      )
    )
      return;
    const success = await mutate(
      {
        action: "RESET_TESTS",
        confirmation: resetConfirmation,
      },
      "Tous les essais du bac à sable ont été effacés. Aucune facture officielle touchée.",
    );
    if (success) {
      setResetConfirmation("");
      setInvoiceId("");
      setCreditReason("");
      setCreditAmount("");
      invoiceRequest.current = null;
      creditRequest.current = null;
    }
  }

  return (
    <section role="tabpanel" className="invoiceCard" style={{ display: "grid", gap: 16 }}>
      <h2>Mode TEST : factures et avoirs fictifs</h2>
      <p role="note" style={{ padding: 12, border: "2px solid #a57b3c", borderRadius: 8 }}>
        <strong>TEST / SANS VALEUR FISCALE.</strong> Les PDF de cette zone sont des spécimens,
        jamais des factures officielles. Aucun numéro fiscal n&apos;est consommé, aucun envoi
        Pennylane ni transmission électronique n&apos;est effectué. Seuls les documents simulés de
        cet onglet pourront être effacés.
      </p>
      {error && (
        <p role="alert" style={{ color: "#a42424" }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: "#246645" }}>
          {notice}
        </p>
      )}
      {!data && !error && <p>Chargement du bac à sable…</p>}
      {data && (
        <>
          <div className="invoiceCard" style={{ display: "grid", gap: 10 }}>
            <h3>1. Simuler une facture depuis un projet validé</h3>
            <label>
              Projet validé en interne
              <select
                value={selectedDraft?.id ?? ""}
                disabled={busy}
                onChange={(event) => {
                  setDraftId(event.target.value);
                  invoiceRequest.current = null;
                }}
              >
                {drafts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.clientName} · {item.affairName} · {item.label} ·{" "}
                    {euros(item.totalTtcCents)}
                  </option>
                ))}
              </select>
            </label>
            {!drafts.length && (
              <p>
                Valide d&apos;abord un projet de facture dans PAPOT pour pouvoir le simuler ici.
              </p>
            )}
            <div className="invoiceMeta">
              <label>
                Date de réalisation
                <input
                  type="date"
                  value={serviceOn}
                  disabled={busy}
                  onChange={(event) => {
                    setServiceOn(event.target.value);
                    invoiceRequest.current = null;
                  }}
                />
              </label>
              <label>
                Échéance de règlement
                <input
                  type="date"
                  value={dueOn}
                  disabled={busy}
                  onChange={(event) => {
                    setDueOn(event.target.value);
                    invoiceRequest.current = null;
                  }}
                />
              </label>
              <label>
                Nature de l&apos;opération
                <select
                  value={operationCategory}
                  disabled={busy}
                  onChange={(event) => {
                    setOperationCategory(event.target.value as "SERVICE" | "GOODS" | "MIXED");
                    invoiceRequest.current = null;
                  }}
                >
                  <option value="SERVICE">Prestation de services</option>
                  <option value="GOODS">Livraison de biens</option>
                  <option value="MIXED">Biens et services</option>
                </select>
              </label>
              <label>
                Pénalités de retard annuelles (%)
                <input
                  type="text"
                  inputMode="decimal"
                  value={latePenaltyRate}
                  disabled={busy}
                  placeholder="À renseigner"
                  onChange={(event) => {
                    setLatePenaltyRate(event.target.value);
                    invoiceRequest.current = null;
                  }}
                />
              </label>
              <label>
                Bon de commande client (facultatif)
                <input
                  type="text"
                  value={buyerPurchaseOrderNumber}
                  disabled={busy}
                  onChange={(event) => {
                    setBuyerPurchaseOrderNumber(event.target.value);
                    invoiceRequest.current = null;
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={vatOnDebits}
                  disabled={busy}
                  onChange={(event) => {
                    setVatOnDebits(event.target.checked);
                    invoiceRequest.current = null;
                  }}
                />
                TVA acquittée sur les débits (si applicable)
              </label>
            </div>
            <button
              type="button"
              className="primaryButton"
              disabled={busy || !selectedDraft || !serviceOn || !dueOn || !latePenaltyRate}
              onClick={() => void simulateInvoice()}
            >
              Créer une facture TEST
            </button>
          </div>

          <div className="invoiceCard" style={{ display: "grid", gap: 10 }}>
            <h3>
              2. Documents simulés ({invoices.length} factures, {credits.length} avoirs)
            </h3>
            {!invoices.length && <p>Aucune facture fictive pour le moment.</p>}
            {invoices.map((item) => (
              <div key={item.id} style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
                <strong>{item.number}</strong> · {item.clientName} · {euros(item.totalTtcCents)}
                <div>Solde fictif après avoirs : {euros(item.remainingTtcCents)}</div>
                <a href={`/api/desktop/billing/test-sandbox/pdf/${item.id}`}>
                  Télécharger la facture TEST
                </a>
                {credits
                  .filter((credit) => credit.originalInvoiceId === item.id)
                  .map((credit) => (
                    <div key={credit.id}>
                      {credit.number} · {euros(credit.totalTtcCents)} · {credit.reason} ·{" "}
                      <a href={`/api/desktop/billing/test-sandbox/pdf/${credit.id}`}>
                        Télécharger l&apos;avoir TEST
                      </a>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {invoices.length > 0 && (
            <div className="invoiceCard" style={{ display: "grid", gap: 10 }}>
              <h3>3. Simuler un avoir</h3>
              <label>
                Facture TEST à corriger
                <select
                  value={selectedInvoice?.id ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    setInvoiceId(event.target.value);
                    setCreditRate("");
                    creditRequest.current = null;
                  }}
                >
                  {invoices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number} · {item.clientName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type d&apos;avoir
                <select
                  value={creditMode}
                  disabled={busy}
                  onChange={(event) => {
                    setCreditMode(event.target.value as "FULL" | "PARTIAL");
                    creditRequest.current = null;
                  }}
                >
                  <option value="FULL">Tout le solde restant</option>
                  <option value="PARTIAL">Correction partielle</option>
                </select>
              </label>
              {creditMode === "PARTIAL" && (
                <div className="invoiceMeta">
                  <label>
                    Taux de TVA
                    <select
                      value={selectedRate ? String(selectedRate.ratePercent) : ""}
                      disabled={busy}
                      onChange={(event) => {
                        setCreditRate(event.target.value);
                        creditRequest.current = null;
                      }}
                    >
                      {availableRates
                        .filter((rate) => rate.remainingHtCents > 0)
                        .map((rate) => (
                          <option key={rate.ratePercent} value={rate.ratePercent}>
                            {rate.ratePercent} % · disponible {euros(rate.remainingHtCents)} HT
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Montant HT à créditer (euros)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={creditAmount}
                      disabled={busy}
                      placeholder="Ex. 125,00"
                      onChange={(event) => {
                        setCreditAmount(event.target.value);
                        creditRequest.current = null;
                      }}
                    />
                  </label>
                </div>
              )}
              <label>
                Motif de correction
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={creditReason}
                  disabled={busy}
                  onChange={(event) => {
                    setCreditReason(event.target.value);
                    creditRequest.current = null;
                  }}
                />
              </label>
              {creditPreview?.valid ? (
                <p role="status">
                  <strong>
                    Avoir TEST prévisionnel : {euros(creditPreview.totalTtcCents)} TTC
                  </strong>{" "}
                  ({euros(creditPreview.htCents)} HT et {euros(creditPreview.vatCents)} de TVA).
                </p>
              ) : (
                <p>{creditPreview?.error ?? "Aucun montant à créditer."}</p>
              )}
              <button
                type="button"
                className="primaryButton"
                disabled={busy || !creditPreview?.valid || creditReason.trim().length < 3}
                onClick={() => void simulateCredit()}
              >
                Créer un avoir TEST
              </button>
            </div>
          )}

          {data.canReset && (
            <div className="invoiceCard" style={{ display: "grid", gap: 10 }}>
              <h3>4. Remettre les essais à zéro</h3>
              <p>
                Cette opération supprime exclusivement les factures et avoirs du bac à sable. Les
                projets, factures officielles, avoirs officiels, leurs numéros et leurs PDF archivés
                restent intacts.
              </p>
              <label>
                Tape exactement <strong>EFFACER LES ESSAIS</strong> pour confirmer.
                <input
                  type="text"
                  value={resetConfirmation}
                  disabled={busy}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="secondaryButton"
                disabled={busy || resetConfirmation !== "EFFACER LES ESSAIS"}
                onClick={() => void resetSandbox()}
              >
                Supprimer les factures et avoirs TEST
              </button>
              {data.sandbox.lastResetAt && (
                <small>
                  Dernière remise à zéro :{" "}
                  {new Date(data.sandbox.lastResetAt).toLocaleString("fr-FR")} par{" "}
                  {data.sandbox.lastResetByName ?? "utilisateur autorisé"}. Total :{" "}
                  {data.sandbox.resetCount}.
                </small>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
