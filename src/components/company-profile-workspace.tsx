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
  if (code === "COMPANY_PROFILE_REQUEST_INVALID")
    return "Certaines informations sont invalides.";
  if (code === "COMPANY_PROFILE_INVALID") return "La fiche société enregistrée est invalide.";
  return code || "Une erreur est survenue.";
}

export function CompanyProfileWorkspace() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/company-profile", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !body?.profile) {
        setError(errorMessage(body?.error ?? "Chargement impossible."));
        return;
      }
      setProfile(body.profile);
    })();
  }, []);

  function update<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setProfile((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
  }

  async function save() {
    if (!profile) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/admin/company-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const body = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !body?.profile) {
        setError(errorMessage(body?.error ?? "Enregistrement impossible."));
        return;
      }
      setProfile(body.profile);
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

      {error && (
        <p className="formError" role="alert">
          {error}
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
              onChange={(value) => update("name", value)}
            />
            <Field
              label="Adresse"
              value={profile.addressLine1}
              onChange={(value) => update("addressLine1", value)}
            />
            <Field
              label="Code postal"
              value={profile.postalCode}
              onChange={(value) => update("postalCode", value)}
            />
            <Field
              label="Ville"
              value={profile.city}
              onChange={(value) => update("city", value)}
            />
            <Field
              label="Téléphone"
              value={profile.phone}
              onChange={(value) => update("phone", value)}
            />
            <Field
              label="E-mail"
              type="email"
              value={profile.email}
              onChange={(value) => update("email", value)}
            />
          </CompanySection>

          <CompanySection title="Informations légales">
            <Field
              label="Forme juridique"
              value={profile.legalForm}
              onChange={(value) => update("legalForm", value)}
            />
            <Field
              label="Capital"
              value={profile.capital}
              onChange={(value) => update("capital", value)}
            />
            <Field
              label="SIRET"
              value={profile.siret}
              onChange={(value) => update("siret", value)}
            />
            <Field
              label="RCS"
              value={profile.rcs}
              onChange={(value) => update("rcs", value)}
            />
            <Field
              label="APE"
              value={profile.ape}
              onChange={(value) => update("ape", value)}
            />
            <Field
              label="TVA intracommunautaire"
              value={profile.vatNumber}
              onChange={(value) => update("vatNumber", value)}
            />
          </CompanySection>

          <CompanySection title="Assurance">
            <Field
              label="Assureur"
              value={profile.insurerName}
              onChange={(value) => update("insurerName", value)}
            />
            <Field
              label="Adresse assureur"
              value={profile.insurerAddress}
              onChange={(value) => update("insurerAddress", value)}
            />
            <Field
              label="Couverture"
              value={profile.insuranceCoverage}
              onChange={(value) => update("insuranceCoverage", value)}
              wide
            />
          </CompanySection>

          <CompanySection title="Paiement et banque">
            <Field
              label="Moyens de paiement"
              value={profile.paymentMethods}
              onChange={(value) => update("paymentMethods", value)}
            />
            <Field
              label="Libellé des chèques"
              value={profile.chequePayee}
              onChange={(value) => update("chequePayee", value)}
            />
            <Field
              label="Banque"
              value={profile.bankName}
              onChange={(value) => update("bankName", value)}
            />
            <Field
              label="Titulaire du compte"
              value={profile.bankAccountHolder}
              onChange={(value) => update("bankAccountHolder", value)}
            />
            <Field
              label="IBAN"
              value={profile.iban}
              onChange={(value) => update("iban", value)}
            />
            <Field
              label="BIC"
              value={profile.bic}
              onChange={(value) => update("bic", value)}
            />
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

function CompanySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="companyProfileCard">
      <h2>{title}</h2>
      <div className="companyProfileGrid">{children}</div>
    </article>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  wide?: boolean;
}) {
  return (
    <label className={`companyField${wide ? " isWide" : ""}`}>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
