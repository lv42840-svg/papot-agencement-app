"use client";

import { useEffect, useState } from "react";
import type { PennylaneAccessProbe, PennylaneAccessState } from "@/lib/pennylane/client";
import type { PennylaneConnectionOverview } from "@/lib/pennylane/connection";

const resourceNames = [
  { key: "suppliers", label: "Fournisseurs" },
  { key: "supplier_invoices", label: "Factures fournisseurs" },
  { key: "customers", label: "Clients" },
  { key: "customer_invoices", label: "Factures clients" },
] as const;

type ApiBody = {
  connection?: PennylaneConnectionOverview;
  test?: PennylaneAccessProbe;
  error?: string;
};

function errorMessage(code?: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Ta session a expiré. Reconnecte-toi.";
    case "ADMIN_FORBIDDEN":
      return "Seul un administrateur peut gérer la connexion Pennylane.";
    case "PENNYLANE_ENCRYPTION_KEY_MISSING":
    case "PENNYLANE_ENCRYPTION_KEY_INVALID":
      return "Le chiffrement des clés doit d'abord être configuré sur le serveur PAPOT.";
    case "PENNYLANE_COMPANY_MISMATCH":
      return "La clé correspond à un autre dossier Pennylane.";
    case "PENNYLANE_TOKEN_INVALID":
      return "Pennylane refuse cette clé. Vérifie qu'elle est valide.";
    case "PENNYLANE_SCOPE_FORBIDDEN":
      return "Il manque des autorisations sur cette clé.";
    case "PENNYLANE_NOT_CONFIGURED":
      return "Enregistre une clé avant de tester.";
    case "PENNYLANE_SECRET_UNREADABLE":
      return "Impossible de déchiffrer la clé. Vérifie la configuration du serveur.";
    case "PENNYLANE_NETWORK_ERROR":
      return "Impossible de joindre Pennylane pour le moment.";
    case "PENNYLANE_REQUEST_INVALID":
    case "PENNYLANE_TOKEN_FORMAT_INVALID":
      return "Vérifie la clé et le nom du dossier comptable.";
    case "PENNYLANE_ORIGIN_FORBIDDEN":
      return "Requête de sécurité refusée. Recharge cette page.";
    default:
      return "Opération impossible. Réessaie ou consulte les contrôles serveur.";
  }
}

function accessText(value: PennylaneAccessState): string {
  if (value === "allowed") return "Accès autorisé";
  if (value === "forbidden") return "Autorisation manquante";
  if (value === "invalid_token") return "Clé refusée";
  return "Accès non vérifié";
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("fr-FR") : "Jamais";
}

export function PennylaneSettingsWorkspace() {
  const [connection, setConnection] = useState<PennylaneConnectionOverview | null>(null);
  const [token, setToken] = useState("");
  const [company, setCompany] = useState("PAPOT LIBERAL");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/pennylane", { cache: "no-store" });
        const body = (await response.json()) as ApiBody;
        if (!response.ok || !body.connection) throw new Error(body.error);
        setConnection(body.connection);
        setCompany(body.connection.expectedCompany);
      } catch {
        setError("Impossible de charger les paramètres Pennylane.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function execute(action: "SAVE" | "TEST" | "REMOVE") {
    if (
      action === "REMOVE" &&
      !window.confirm("Supprimer la clé Pennylane et les données importées en attente ?")
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload =
        action === "SAVE" ? { action, token, expectedCompany: company.trim() } : { action };
      const response = await fetch("/api/admin/pennylane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as ApiBody;
      if (!response.ok || !body.connection) {
        setError(errorMessage(body.error));
        return;
      }
      setConnection(body.connection);
      if (action === "SAVE") {
        setToken("");
        setShowToken(false);
        setNotice(
          "Clé enregistrée et chiffrée sur le serveur. La synchronisation reste désactivée.",
        );
      } else if (action === "REMOVE") {
        setToken("");
        setNotice(
          "Clé et données importées supprimées. Aucune donnée métier PAPOT n'a été modifiée.",
        );
      } else if (body.test) {
        const complete = Object.values(body.test.access).every((value) => value === "allowed");
        setNotice(
          complete
            ? "Connexion vérifiée : les quatre accès en lecture sont autorisés."
            : "Société reconnue. Certains accès nécessitent encore des autorisations.",
        );
      }
    } catch {
      setError("Connexion interrompue. Aucun changement confirmé.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Chargement des paramètres Pennylane…</p>;
  if (!connection)
    return (
      <p role="alert" className="formError">
        {error}
      </p>
    );

  return (
    <main className="pennylaneSettings">
      <div className="dashboardHeading">
        <div>
          <h1>Connexion Pennylane</h1>
          <p className="muted">
            Configure la clé API depuis PAPOT. La connexion est uniquement en lecture : aucune
            facture ou donnée comptable n'est modifiée.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="formError">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="pennylaneNotice">
          {notice}
        </p>
      ) : null}

      <article className="companyProfileCard">
        <h2>État de la connexion</h2>
        <dl className="pennylaneSummary">
          <div>
            <dt>Clé API</dt>
            <dd>{connection.configured ? "Enregistrée (masquée)" : "Non configurée"}</dd>
          </div>
          <div>
            <dt>Dossier attendu</dt>
            <dd>{connection.expectedCompany}</dd>
          </div>
          <div>
            <dt>Dernier enregistrement</dt>
            <dd>{formatDate(connection.updatedAt)}</dd>
          </div>
          <div>
            <dt>Dernier test</dt>
            <dd>{formatDate(connection.lastTestedAt)}</dd>
          </div>
          <div>
            <dt>Synchronisation</dt>
            <dd>
              {connection.syncEnabled
                ? "Autorisation serveur activée"
                : "Désactivée, aucun import automatique"}
            </dd>
          </div>
        </dl>
      </article>

      <article className="companyProfileCard">
        <h2>Clé d'accès API</h2>
        {!connection.encryptionReady ? (
          <p className="formError" role="alert">
            Protection serveur non configurée : l'administrateur technique doit ajouter
            PAPOT_PENNYLANE_ENCRYPTION_KEY sur le VPS avant de pouvoir enregistrer une clé.
          </p>
        ) : null}
        <div className="pennylaneForm">
          <label>
            Dossier comptable Pennylane
            <input
              value={company}
              maxLength={120}
              onChange={(event) => setCompany(event.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            Nouvelle clé API (elle ne sera jamais réaffichée)
            <span className="pennylaneSecretRow">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  connection.configured
                    ? "Saisir une nouvelle clé pour la remplacer"
                    : "Coller la clé API"
                }
                disabled={!connection.encryptionReady || busy}
                aria-label="Clé API Pennylane"
              />
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setShowToken((current) => !current)}
                disabled={!token || busy}
                aria-label={showToken ? "Masquer la clé" : "Afficher la clé"}
              >
                {showToken ? "Masquer" : "Afficher"}
              </button>
            </span>
          </label>
          <div className="buttonRow">
            <button
              className="primaryButton"
              type="button"
              disabled={
                busy || !connection.encryptionReady || token.trim().length < 20 || !company.trim()
              }
              onClick={() => void execute("SAVE")}
            >
              {busy
                ? "Traitement…"
                : connection.configured
                  ? "Remplacer la clé"
                  : "Enregistrer la clé"}
            </button>
            <button
              className="secondaryButton"
              type="button"
              disabled={busy || !connection.configured || !connection.encryptionReady}
              onClick={() => void execute("TEST")}
            >
              Tester la connexion
            </button>
            <button
              className="secondaryButton"
              type="button"
              disabled={busy || !connection.configured}
              onClick={() => void execute("REMOVE")}
            >
              Supprimer la clé
            </button>
          </div>
        </div>
        <p className="muted pennylaneHelp">
          Utilise une nouvelle clé : l'ancienne clé envoyée par e-mail doit être révoquée. Seuls les
          administrateurs PAPOT autorisés peuvent modifier cette configuration.
        </p>
      </article>

      {connection.lastTest ? (
        <article className="companyProfileCard">
          <h2>Résultat du contrôle des autorisations</h2>
          <p className="muted">Société identifiée : {connection.lastTest.companyName}</p>
          <dl className="pennylaneSummary">
            {resourceNames.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{accessText(connection.lastTest!.access[key])}</dd>
              </div>
            ))}
          </dl>
          <p className="muted pennylaneHelp">
            Un accès manquant signifie que la clé ne possède pas encore les permissions requises. Le
            test n'enregistre aucune facture.
          </p>
        </article>
      ) : null}

      <style jsx global>{`
        .pennylaneSettings {
          display: grid;
          gap: 16px;
          max-width: 980px;
        }
        .pennylaneSettings .companyProfileCard {
          border: 1px solid #e7e2ef;
          border-radius: 16px;
          background: #fff;
          padding: 20px;
          box-shadow: 0 5px 18px rgb(55 39 112 / 0.05);
        }
        .pennylaneSettings .companyProfileCard h2 {
          margin: 0 0 16px;
          font-size: 17px;
        }
        .pennylaneSummary {
          margin: 0;
          display: grid;
          gap: 10px;
        }
        .pennylaneSummary > div {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 18px;
          border-bottom: 1px solid #f1eef6;
          padding: 8px 0;
        }
        .pennylaneSummary dt {
          color: #6d7080;
        }
        .pennylaneSummary dd {
          font-weight: 650;
          margin: 0;
          text-align: right;
        }
        .pennylaneForm {
          display: grid;
          gap: 16px;
        }
        .pennylaneForm label {
          display: grid;
          gap: 7px;
          font-size: 13px;
          font-weight: 650;
        }
        .pennylaneSecretRow {
          display: flex;
          gap: 8px;
        }
        .pennylaneSecretRow input {
          flex: 1;
          min-width: 150px;
        }
        .pennylaneSettings .buttonRow {
          margin-top: 4px;
        }
        .pennylaneNotice {
          margin: 0;
          padding: 12px;
          border: 1px solid #cce4d5;
          background: #f0faf4;
          border-radius: 10px;
          color: #2e6a43;
        }
        .pennylaneHelp {
          margin: 16px 0 0;
          font-size: 13px;
        }
        @media (max-width: 680px) {
          .pennylaneSecretRow {
            flex-wrap: wrap;
          }
          .pennylaneSecretRow button {
            width: 100%;
          }
          .pennylaneSummary > div {
            display: grid;
            gap: 4px;
          }
          .pennylaneSummary dd {
            text-align: left;
          }
        }
      `}</style>
    </main>
  );
}
