"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Connexion impossible.");
      setBusy(false);
      return;
    }
    const body = (await response.json()) as { mustChangePassword?: boolean };
    router.replace(body.mustChangePassword ? "/change-password" : "/");
    router.refresh();
  }

  return (
    <form className="loginForm" onSubmit={submit}>
      <label>
        Adresse e-mail
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Mot de passe
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && (
        <p className="formError" role="alert">
          {error}
        </p>
      )}
      <button className="primaryButton" type="submit" disabled={busy}>
        {busy ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
