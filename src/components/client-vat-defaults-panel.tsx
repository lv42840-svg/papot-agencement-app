"use client";

import { Percent, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clientDisplayName, type ClientsPayload } from "@/lib/clients/domain";

type ClientsSnapshot = {
  payload: ClientsPayload;
  canWrite: boolean;
  focusClientId?: string;
  error?: string;
};

function rateInput(valeur: number): string {
  return String(valeur).replace(".", ",");
}

function parseRate(valeur: string): number | null {
  const rate = Number(valeur.trim().replace(",", "."));
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null;
}

export function ClientVatDefaultsPanel() {
  const [snapshot, setSnapshot] = useState<ClientsSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [rate, setRate] = useState("20");
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const reponse = await fetch("/api/desktop/clients", { cache: "no-store" });
        const corps = (await reponse.json()) as ClientsSnapshot;
        if (!reponse.ok) throw new Error(corps.error ?? "CLIENTS_LOAD_FAILED");
        if (cancelled) return;
        setSnapshot(corps);
        const first = corps.payload.clients.find((client) => !client.isArchived);
        if (first) {
          setSelectedId(first.id);
          setRate(rateInput(first.defaultVatRatePercent));
        }
      } catch {
        if (!cancelled) setError("Impossible de charger les taux de TVA clients.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const clients = useMemo(
    () =>
      (snapshot?.payload.clients ?? [])
        .filter((client) => !client.isArchived)
        .sort((gauche, droite) =>
          clientDisplayName(gauche).localeCompare(clientDisplayName(droite), "fr-FR", {
            sensitivity: "base",
          }),
        ),
    [snapshot?.payload.clients],
  );

  function selectClient(idClient: string) {
    setSelectedId(idClient);
    const client = snapshot?.payload.clients.find((candidat) => candidat.id === idClient);
    if (client) setRate(rateInput(client.defaultVatRatePercent));
    setError("");
    setNotice("");
  }

  async function save() {
    if (!snapshot?.canWrite || !selectedId || busy) return;
    const analyse = parseRate(rate);
    if (analyse === null) {
      setError("Le taux de TVA doit être compris entre 0 et 100 %.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reponse = await fetch("/api/desktop/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateVat",
          clientId: selectedId,
          defaultVatRatePercent: analyse,
        }),
      });
      const corps = (await reponse.json()) as ClientsSnapshot;
      if (!reponse.ok) throw new Error(corps.error ?? "CLIENT_VAT_UPDATE_FAILED");
      setSnapshot(corps);
      const saved = corps.payload.clients.find((client) => client.id === selectedId);
      if (saved) setRate(rateInput(saved.defaultVatRatePercent));
      setNotice("TVA par défaut enregistrée pour cette fiche client.");
    } catch {
      setError("Le taux de TVA n’a pas pu être enregistré.");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot && !erreur) return null;

  return (
    <section className="panel clientVatPanel" aria-label="TVA par défaut des fiches clients">
      <div className="clientVatHeading">
        <div>
          <p className="eyebrow">Fiches clients</p>
          <h3>TVA par défaut</h3>
          <p className="muted">
            Ce taux est repris à la création du devis. Une ligne de devis peut ensuite utiliser un
            autre taux si nécessaire.
          </p>
        </div>
        <Percent size={22} aria-hidden="true" />
      </div>

      {clients.length > 0 ? (
        <div className="clientVatForm">
          <label>
            <span>Client</span>
            <select
              value={selectedId}
              onChange={(evenement) => selectClient(evenement.target.value)}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {clientDisplayName(client)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Taux de TVA par défaut (%)</span>
            <input
              value={rate}
              onChange={(evenement) => setRate(evenement.target.value)}
              inputMode="decimal"
              disabled={!snapshot?.canWrite || busy}
              aria-label="Taux de TVA par défaut"
            />
          </label>
          {snapshot?.canWrite ? (
            <button
              className="primaryButton"
              type="button"
              onClick={() => void save()}
              disabled={busy}
            >
              <Save size={14} aria-hidden="true" /> {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="muted">Aucun client actif.</p>
      )}

      {erreur ? <p className="clientVatError">{erreur}</p> : null}
      {notice ? <p className="clientVatSuccess">{notice}</p> : null}

      <style jsx>{`
        .clientVatPanel {
          margin-top: 14px;
          padding: 16px;
          display: grid;
          gap: 12px;
        }
        .clientVatHeading {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
        }
        .clientVatHeading h3,
        .clientVatHeading p {
          margin-bottom: 4px;
        }
        .clientVatHeading .muted {
          max-width: 720px;
        }
        .clientVatForm {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) minmax(180px, 240px) auto;
          gap: 10px;
          align-items: end;
        }
        .clientVatForm label {
          display: grid;
          gap: 5px;
        }
        .clientVatForm label > span {
          color: var(--muted);
          font-size: 11px;
          font-weight: 750;
        }
        .clientVatForm input,
        .clientVatForm select {
          min-height: 38px;
        }
        .clientVatForm button {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .clientVatError,
        .clientVatSuccess {
          margin: 0;
          padding: 8px 10px;
          border-radius: 7px;
          font-size: 12px;
        }
        .clientVatError {
          background: #fff0f0;
          color: #9c3434;
        }
        .clientVatSuccess {
          background: #eff9f3;
          color: #347850;
        }
        @media (max-width: 760px) {
          .clientVatForm {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
