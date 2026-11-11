"use client";

import { useEffect, useState } from "react";
import type { CompanyProfile } from "@/lib/company-profile/domain";
import { SettingsSectionNav } from "./settings-section-nav";

type ApiResponse = {
  profile?: CompanyProfile;
  error?: string;
};

function errorMessage(code: string) {
  if (code === "ADMIN_FORBIDDEN") return "Administration non autorisée.";
  if (code === "AUTH_REQUIRED") return "Connexion requise.";
  if (code === "COMPANY_PROFILE_REQUEST_INVALID") return "Certaines informations sont invalides.";
  if (code === "COMPANY_PROFILE_INVALID") return "La fiche société enregistrée est invalide.";
  return code || "Une erreur est survenue.";
}

export function CompanyProfileWorkspace() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [erreur, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const reponse = await fetch("/api/admin/company-profile", { cache: "no-store" });
      const corps = (await reponse.json().catch(() => null)) as ApiResponse | null;
      if (!reponse.ok || !corps?.profile) {
        setError(errorMessage(corps?.error ?? "Chargement impossible."));
        return;
      }
      setProfile(corps.profile);
    })();
  }, []);

  function update<K extends keyof CompanyProfile>(cle: K, valeur: CompanyProfile[K]) {
    setProfile((courant) => (courant ? { ...courant, [cle]: valeur } : courant));
    setSaved(false);
  }

  async function save() {
    if (!profile) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const reponse = await fetch("/api/admin/company-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const corps = (await reponse.json().catch(() => null)) as ApiResponse | null;
      if (!reponse.ok || !corps?.profile) {
        setError(errorMessage(corps?.error ?? "Enregistrement impossible."));
        return;
      }
      setProfile(corps.profile);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="companyProfilePage">
      <SettingsSectionNav active="company" />
      <div className="dashboardHeading">
        <div>
          <h1>Fiche société</h1>
          <p className="muted">
            Source unique des coordonnées légales, d’assurance, de paiement et bancaires utilisées
            dans les devis PAPOT.
          </p>
        </div>
      </div>

      {erreur && (
        <p className="formError" role="alert">
          {erreur}
        </p>
      )}
      {saved && <p className="companySaved">Fiche société enregistrée.</p>}

      {!profile ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <CompanySection title="Identité et coordonnées">
            <Field
              label="Raison sociale"
              value={profile.name}
              onChange={(valeur) => update("name", valeur)}
            />
            <Field
              label="Adresse"
              value={profile.addressLine1}
              onChange={(valeur) => update("addressLine1", valeur)}
            />
            <Field
              label="Code postal"
              value={profile.postalCode}
              onChange={(valeur) => update("postalCode", valeur)}
            />
            <Field
              label="Ville"
              value={profile.city}
              onChange={(valeur) => update("city", valeur)}
            />
            <Field
              label="Téléphone"
              value={profile.phone}
              onChange={(valeur) => update("phone", valeur)}
            />
            <Field
              label="E-mail"
              type="email"
              value={profile.email}
              onChange={(valeur) => update("email", valeur)}
            />
          </CompanySection>

          <CompanySection title="Informations légales">
            <Field
              label="Forme juridique"
              value={profile.legalForm}
              onChange={(valeur) => update("legalForm", valeur)}
            />
            <Field
              label="Capital"
              value={profile.capital}
              onChange={(valeur) => update("capital", valeur)}
            />
            <Field
              label="SIRET"
              value={profile.siret}
              onChange={(valeur) => update("siret", valeur)}
            />
            <Field label="RCS" value={profile.rcs} onChange={(valeur) => update("rcs", valeur)} />
            <Field label="APE" value={profile.ape} onChange={(valeur) => update("ape", valeur)} />
            <Field
              label="TVA intracommunautaire"
              value={profile.vatNumber}
              onChange={(valeur) => update("vatNumber", valeur)}
            />
          </CompanySection>

          <CompanySection title="Assurance">
            <Field
              label="Assureur"
              value={profile.insurerName}
              onChange={(valeur) => update("insurerName", valeur)}
            />
            <Field
              label="Adresse assureur"
              value={profile.insurerAddress}
              onChange={(valeur) => update("insurerAddress", valeur)}
            />
            <Field
              label="Couverture"
              value={profile.insuranceCoverage}
              onChange={(valeur) => update("insuranceCoverage", valeur)}
              wide
            />
          </CompanySection>

          <CompanySection title="Paiement et banque">
            <Field
              label="Moyens de paiement"
              value={profile.paymentMethods}
              onChange={(valeur) => update("paymentMethods", valeur)}
            />
            <Field
              label="Libellé des chèques"
              value={profile.chequePayee}
              onChange={(valeur) => update("chequePayee", valeur)}
            />
            <Field
              label="Banque"
              value={profile.bankName}
              onChange={(valeur) => update("bankName", valeur)}
            />
            <Field
              label="Titulaire du compte"
              value={profile.bankAccountHolder}
              onChange={(valeur) => update("bankAccountHolder", valeur)}
            />
            <Field
              label="IBAN"
              value={profile.iban}
              onChange={(valeur) => update("iban", valeur)}
            />
            <Field label="BIC" value={profile.bic} onChange={(valeur) => update("bic", valeur)} />
          </CompanySection>

          <div className="companyProfileActions">
            <button
              className="primaryButton"
              type="button"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Enregistrement…" : "Enregistrer la fiche société"}
            </button>
          </div>
        </>
      )}

      <style jsx global>{`
        .companyProfilePage {
          display: grid;
          gap: 16px;
        }
        .companyProfileCard {
          border: 1px solid #e7e2ef;
          border-radius: 16px;
          background: #fff;
          padding: 18px;
          box-shadow: 0 5px 18px rgb(55 39 112 / 0.05);
        }
        .companyProfileCard h2 {
          margin: 0 0 14px;
          font-size: 16px;
        }
        .companyProfileGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .companyField {
          display: grid;
          gap: 6px;
          font-size: 13px;
          font-weight: 650;
        }
        .companyField.isWide {
          grid-column: 1 / -1;
        }
        .companyField input {
          min-height: 40px;
          border: 1px solid #dcd6eb;
          border-radius: 10px;
          padding: 8px 10px;
          background: #fff;
          font: inherit;
          font-weight: 400;
        }
        .companyProfileActions {
          display: flex;
          justify-content: flex-end;
        }
        .companySaved {
          margin: 0;
          border: 1px solid #cce4d5;
          border-radius: 10px;
          background: #f0faf4;
          color: #2e6a43;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 650;
        }
      `}</style>
    </section>
  );
}

function CompanySection({ title: titre, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="companyProfileCard">
      <h2>{titre}</h2>
      <div className="companyProfileGrid">{children}</div>
    </article>
  );
}

function Field({
  label: libelle,
  value: valeur,
  onChange,
  type = "text",
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (valeur: string) => void;
  type?: "text" | "email";
  wide?: boolean;
}) {
  return (
    <label className={`companyField${wide ? " isWide" : ""}`}>
      {libelle}
      <input
        type={type}
        value={valeur}
        onChange={(evenement) => onChange(evenement.target.value)}
      />
    </label>
  );
}
