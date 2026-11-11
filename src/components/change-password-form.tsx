"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ChangePasswordForm() {
  const router = useRouter();
  const [erreur, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    setError("");
    const donnees = new FormData(evenement.currentTarget);
    const password = String(donnees.get("password") ?? "");
    const confirmation = String(donnees.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    const reponse = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!reponse.ok) {
      const corps = (await reponse.json().catch(() => null)) as { error?: string } | null;
      setError(corps?.error ?? "Modification impossible.");
      setBusy(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>
        Nouveau mot de passe
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      <label>
        Confirmer le mot de passe
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      {erreur && (
        <p className="formError" role="alert">
          {erreur}
        </p>
      )}
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </button>
    </form>
  );
}
