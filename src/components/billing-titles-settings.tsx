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
        const reponse = await fetch("/api/desktop/billing", { cache: "no-store" });
        const resultat = (await reponse.json()) as {
          payload?: BillingPayload;
          canWrite?: boolean;
          error?: string;
        };
        if (!reponse.ok) throw new Error(resultat.error ?? "Chargement impossible");
        setTitles(resultat.payload?.invoiceTitles ?? [...DEFAULT_BILLING_TITLES]);
        setCanWrite(Boolean(resultat.canWrite));
      } catch {
        setMessage("Impossible de charger les intitulés de facturation.");
      }
    })();
  }, []);

  async function save() {
    const clean = titles.map((valeur) => valeur.trim());
    if (
      clean.length === 0 ||
      clean.length > 50 ||
      clean.some((valeur) => valeur.length === 0 || valeur.length > 240) ||
      new Set(clean.map((valeur) => valeur.toLocaleLowerCase("fr-FR"))).size !== clean.length
    ) {
      setMessage("Renseigne 1 à 50 intitulés distincts, sans ligne vide.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const reponse = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_TITLES", invoiceTitles: clean }),
      });
      if (!reponse.ok) throw new Error("Enregistrement refusé");
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
        Ces propositions apparaissent dans la liste déroulante du projet de facture. Modifier la
        liste ne modifie pas les projets existants.
      </p>
      {titles.map((valeur, indice) => (
        <div key={indice} style={{ display: "flex", gap: 8 }}>
          <input
            aria-label={`Intitulé ${indice + 1}`}
            style={{ flex: 1, padding: 9 }}
            disabled={!canWrite || pending}
            maxLength={240}
            value={valeur}
            onChange={(e) =>
              setTitles((courant) =>
                courant.map((element, itemIndex) =>
                  itemIndex === indice ? e.target.value : element,
                ),
              )
            }
          />
          <button
            type="button"
            className="secondaryButton"
            disabled={!canWrite || pending || titles.length <= 1}
            onClick={() =>
              setTitles((courant) => courant.filter((_, itemIndex) => itemIndex !== indice))
            }
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
          onClick={() => setTitles((courant) => [...courant, "Nouvel intitulé"])}
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
      {!canWrite ? (
        <p>Gestion des intitulés réservée aux utilisateurs autorisés à modifier la facturation.</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
