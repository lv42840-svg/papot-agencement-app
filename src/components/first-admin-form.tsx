"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function FirstAdminForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");

    const response = await fetch("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: String(form.get("displayName") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Impossible de créer l’administrateur PAPOT.");
      setBusy(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>
        Nom de l’administrateur
        <input name="displayName" autoComplete="name" required disabled={busy} />
      </label>
      <label>
        Adresse e-mail PAPOT
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
      {error ? <p className="formError">{error}</p> : null}
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? "Création…" : "Créer l’administrateur PAPOT"}
      </button>
    </form>
  );
}
