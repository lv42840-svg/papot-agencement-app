"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [erreur, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    setError("");
    setBusy(true);
    const donnees = new FormData(evenement.currentTarget);
    const reponse = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: donnees.get("username"),
        password: donnees.get("password"),
      }),
    });
    if (!reponse.ok) {
      const corps = (await reponse.json().catch(() => null)) as { error?: string } | null;
      setError(corps?.error ?? "Connexion impossible.");
      setBusy(false);
      return;
    }
    await reponse.json();
    router.replace("/");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>
        Identifiant
        <input name="username" autoComplete="username" minLength={3} maxLength={80} required />
      </label>
      <label>
        Mot de passe
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {erreur && (
        <p className="formError" role="alert">
          {erreur}
        </p>
      )}
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
