"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function FirstAdminForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erreur, setError] = useState("");

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const form = new FormData(evenement.currentTarget);
    setBusy(true);
    setError("");

    const reponse = await fetch("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bootstrapToken: String(form.get("bootstrapToken") ?? ""),
        username: String(form.get("username") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    });
    const corps = (await reponse.json().catch(() => null)) as { error?: string } | null;
    if (!reponse.ok) {
      setError(corps?.error ?? "Impossible de créer l’administrateur PAPOT.");
      setBusy(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>
        Clé d’initialisation
        <input name="bootstrapToken" type="password" autoComplete="off" required disabled={busy} />
      </label>
      <label>
        Identifiant
        <input
          name="username"
          minLength={3}
          maxLength={80}
          pattern="[A-Za-z0-9._-]+"
          autoComplete="username"
          required
          disabled={busy}
        />
      </label>
      <label>
        Nom de l’administrateur
        <input name="displayName" autoComplete="name" required disabled={busy} />
      </label>
      <label>
        Adresse e-mail PAPOT (profil)
        <input name="email" type="email" autoComplete="email" required disabled={busy} />
      </label>
      <label>
        Mot de passe
        <input
          name="password"
          type="password"
          minLength={12}
          autoComplete="new-password"
          required
          disabled={busy}
        />
      </label>
      <p className="muted">
        12 caractères minimum. Ce compte pourra ensuite créer les autres utilisateurs et leurs
        droits.
      </p>
      {erreur ? <p className="formError">{erreur}</p> : null}
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? "Création…" : "Créer l’administrateur PAPOT"}
      </button>
    </form>
  );
}
