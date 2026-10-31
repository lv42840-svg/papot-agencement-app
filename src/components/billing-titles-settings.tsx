"use client";

import { useEffect, useState } from "react";
import { DEFAULT_BILLING_TITLES, type BillingPayload } from "@/lib/billing/domain";

export function BillingTitlesSettings() {
  const [titles, setTitles] = useState<string[]>([...DEFAULT_BILLING_TITLES]);
  const [canWrite, setCanWrite] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/desktop/billing", { cache: "no-store" });
        const result = (await response.json()) as {
          payload?: BillingPayload;
          canWrite?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Chargement impossible");
        setTitles(result.payload?.invoiceTitles ?? [...DEFAULT_BILLING_TITLES]);
        setCanWrite(Boolean(result.canWrite));
      } catch {
        setMessage("Impossible de charger les intitulés de facturation.");
      }
    })();
  }, []);

  async function save() {
    const clean = titles.map((value) => value.trim());
    if (
      clean.length === 0 ||
      clean.length > 50 ||
      clean.some((value) => value.length === 0 || value.length > 240) ||
      new Set(clean.map((value) => value.toLocaleLowerCase("fr-FR"))).size !== clean.length
    ) {
      setMessage("Renseigne 1 à 50 intitulés distincts, sans ligne vide.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_TITLES", invoiceTitles: clean }),
      });
      if (!response.ok) throw new Error("Enregistrement refusé");
      setTitles(clean);
      setMessage("Intitulés enregistrés pour les prochains projets de facture.");
    } catch {
      setMessage("Enregistrement impossible. Vérifie tes droits Facturation.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={{ maxWidth: 850, display: "grid", gap: 16 }}>
      <h1>Intitulés des factures</h1>
      <p>
        Ces propositions apparaissent dans la liste déroulante du projet de facture.
        Modifier la liste ne modifie pas les projets existants.
      </p>
      {titles.map((value, index) => (
        <div key={index} style={{ display: "flex", gap: 8 }}>
          <input
            aria-label={`Intitulé ${index + 1}`}
            style={{ flex: 1, padding: 9 }}
            disabled={!canWrite || pending}
            maxLength={240}
            value={value}
            onChange={(e) =>
              setTitles((current) =>
                current.map((item, itemIndex) => (itemIndex === index ? e.target.value : item)),
              )
            }
          />
          <button
            type="button"
            className="secondaryButton"
            disabled={!canWrite || pending || titles.length <= 1}
            onClick={() => setTitles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          >
            Supprimer
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="secondaryButton"
          disabled={!canWrite || pending || titles.length >= 50}
          onClick={() => setTitles((current) => [...current, "Nouvel intitulé"])}
        >
          Ajouter un intitulé
        </button>
        <button
          type="button"
          className="primaryButton"
          disabled={!canWrite || pending}
          onClick={() => void save()}
        >
          Enregistrer
        </button>
      </div>
      {!canWrite ? <p>Gestion des intitulés réservée aux utilisateurs autorisés à modifier la facturation.</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
