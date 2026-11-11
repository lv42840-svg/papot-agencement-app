"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function SetupPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [erreur, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    setError("");
    setBusy(true);

    const donnees = new FormData(evenement.currentTarget);
    const password = String(donnees.get("password") ?? "");
    const confirmPassword = String(donnees.get("confirmPassword") ?? "");

    const reponse = await fetch("/api/auth/setup-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password, confirmPassword }),
    });
    const corps = (await reponse.json().catch(() => null)) as { error?: string } | null;

    if (!reponse.ok) {
      setError(corps?.error ?? "Impossible de définir le mot de passe.");
      setBusy(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>
        Nouveau mot de passe
        <input
          name="password"
          type="password"
          minLength={12}
          maxLength={512}
          autoComplete="new-password"
          required
          disabled={busy}
        />
      </label>
      <label>
        Confirmer le mot de passe
        <input
          name="confirmPassword"
          type="password"
          minLength={12}
          maxLength={512}
          autoComplete="new-password"
          required
          disabled={busy}
        />
      </label>
      <p className="muted">12 caractères minimum. Le lien est à usage unique.</p>
      {erreur ? (
        <p className="formError" role="alert">
          {erreur}
        </p>
      ) : null}
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? "Enregistrement…" : "Définir mon mot de passe"}
      </button>
    </form>
  );
}
