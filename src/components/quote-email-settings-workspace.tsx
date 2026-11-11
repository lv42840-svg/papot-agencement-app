"use client";

import { useEffect, useState } from "react";
import {
  QUOTE_EMAIL_TEMPLATE_VARIABLES,
  type QuoteEmailSettings,
} from "@/lib/quote-email-settings/domain";

type ApiResponse = { settings?: QuoteEmailSettings; error?: string };

function message(code: string) {
  if (code === "ADMIN_FORBIDDEN") return "Administration non autorisée.";
  if (code === "AUTH_REQUIRED") return "Connexion requise.";
  if (code === "QUOTE_EMAIL_SETTINGS_REQUEST_INVALID") {
    return "Vérifie les adresses e-mail et les variables utilisées dans le modèle.";
  }
  if (code === "QUOTE_EMAIL_SETTINGS_INVALID") {
    return "Le modèle d’e-mail enregistré est invalide.";
  }
  return code || "Une erreur est survenue.";
}

export function QuoteEmailSettingsWorkspace() {
  const [reglages, setSettings] = useState<QuoteEmailSettings | null>(null);
  const [erreur, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const reponse = await fetch("/api/admin/quote-email-settings", { cache: "no-store" });
      const corps = (await reponse.json().catch(() => null)) as ApiResponse | null;
      if (!reponse.ok || !corps?.settings) {
        setError(message(corps?.error ?? "Chargement impossible."));
        return;
      }
      setSettings(corps.settings);
    })();
  }, []);

  function update<K extends keyof QuoteEmailSettings>(cle: K, valeur: QuoteEmailSettings[K]) {
    setSettings((courant) => (courant ? { ...courant, [cle]: valeur } : courant));
    setSaved(false);
  }

  async function save() {
    if (!reglages) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const reponse = await fetch("/api/admin/quote-email-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reglages),
      });
      const corps = (await reponse.json().catch(() => null)) as ApiResponse | null;
      if (!reponse.ok || !corps?.settings) {
        setError(message(corps?.error ?? "Enregistrement impossible."));
        return;
      }
      setSettings(corps.settings);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  if (!reglages) {
    return <p className="muted">{erreur || "Chargement…"}</p>;
  }

  return (
    <section className="quoteEmailSettings">
      <div className="dashboardHeading">
        <div>
          <h1>E-mails des devis</h1>
          <p className="muted">
            Même principe que les bons de commande PAPOT CONCEPT : modèle partagé dans les
            paramètres, puis message modifiable juste avant l’envoi.
          </p>
        </div>
      </div>

      {erreur ? (
        <p className="formError" role="alert">
          {erreur}
        </p>
      ) : null}
      {saved ? <p className="companySaved">Modèle d’e-mail enregistré.</p> : null}

      <article className="companyProfileCard">
        <h2>Adresses utilisées à l’envoi</h2>
        <div className="companyProfileGrid">
          <Field
            label="Adresse d’envoi"
            type="email"
            value={reglages.fromEmail}
            onChange={(valeur) => update("fromEmail", valeur)}
          />
          <Field
            label="Copie automatique"
            type="email"
            value={reglages.ccEmail}
            onChange={(valeur) => update("ccEmail", valeur)}
          />
          <Field
            label="Réponses vers"
            type="email"
            value={reglages.replyToEmail}
            onChange={(valeur) => update("replyToEmail", valeur)}
          />
        </div>
      </article>

      <article className="companyProfileCard">
        <h2>Modèle d’e-mail</h2>
        <div className="quoteEmailForm">
          <label>
            Objet
            <input
              value={reglages.subjectTemplate}
              onChange={(evenement) => update("subjectTemplate", evenement.target.value)}
            />
          </label>
          <label>
            Message
            <textarea
              rows={12}
              value={reglages.bodyTemplate}
              onChange={(evenement) => update("bodyTemplate", evenement.target.value)}
            />
          </label>
          <p className="muted">
            Variables disponibles :{" "}
            {QUOTE_EMAIL_TEMPLATE_VARIABLES.map((nom) => `{{${nom}}}`).join(", ")}
          </p>
        </div>
      </article>

      <div className="companyProfileActions">
        <button className="primaryButton" type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer le modèle d’e-mail"}
        </button>
      </div>

      <style jsx global>{`
        .quoteEmailSettings {
          display: grid;
          gap: 16px;
        }
        .quoteEmailSettings .companyProfileCard {
          border: 1px solid #e7e2ef;
          border-radius: 16px;
          background: #fff;
          padding: 18px;
          box-shadow: 0 5px 18px rgb(55 39 112 / 0.05);
        }
        .quoteEmailSettings .companyProfileCard h2 {
          margin: 0 0 14px;
          font-size: 16px;
        }
        .quoteEmailSettings .companyProfileGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .quoteEmailSettings .companyField {
          display: grid;
          gap: 6px;
          font-size: 13px;
          font-weight: 650;
        }
        .quoteEmailSettings .companyField input {
          min-height: 40px;
          border: 1px solid #dcd6eb;
          border-radius: 10px;
          padding: 8px 10px;
          background: #fff;
          font: inherit;
          font-weight: 400;
        }
        .quoteEmailSettings .companyProfileActions {
          display: flex;
          justify-content: flex-end;
        }
        .quoteEmailSettings .companySaved {
          margin: 0;
          border: 1px solid #cce4d5;
          border-radius: 10px;
          background: #f0faf4;
          color: #2e6a43;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 650;
        }
        .quoteEmailForm {
          display: grid;
          gap: 12px;
        }
        .quoteEmailForm label {
          display: grid;
          gap: 6px;
          font-size: 13px;
          font-weight: 650;
        }
        .quoteEmailForm input,
        .quoteEmailForm textarea {
          width: 100%;
          border: 1px solid #dcd6eb;
          border-radius: 10px;
          padding: 9px 10px;
          background: #fff;
          color: inherit;
          font: inherit;
          font-weight: 400;
        }
        .quoteEmailForm textarea {
          resize: vertical;
          min-height: 220px;
        }
      `}</style>
    </section>
  );
}

function Field({
  label: libelle,
  value: valeur,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (valeur: string) => void;
  type?: "text" | "email";
}) {
  return (
    <label className="companyField">
      {libelle}
      <input
        type={type}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
      />
    </label>
  );
}
