"use client";

import { FormEvent, useState } from "react";

type SetupState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

const errorMessages: Record<string, string> = {
  DESKTOP_SETUP_INVALID: "La configuration envoyée est invalide.",
  DESKTOP_SHARED_PATH_REQUIRED: "Le chemin du dossier partagé est obligatoire.",
  DESKTOP_SHARED_PATH_INVALID: "Le chemin du dossier partagé n’est pas un chemin Windows valide.",
  DESKTOP_SHARED_PATH_UNAVAILABLE: "PAPOT n’arrive pas à lire et écrire dans le dossier partagé.",
  DESKTOP_NEXTCLOUD_URL_REQUIRED: "L’adresse Nextcloud est obligatoire.",
  DESKTOP_NEXTCLOUD_URL_INVALID: "L’adresse Nextcloud est invalide.",
  DESKTOP_NEXTCLOUD_HTTPS_REQUIRED: "Nextcloud doit utiliser une adresse HTTPS.",
  DESKTOP_NEXTCLOUD_LOGIN_REQUIRED: "Le compte technique Nextcloud est obligatoire.",
  DESKTOP_NEXTCLOUD_PASSWORD_REQUIRED: "Le mot de passe d’application Nextcloud est obligatoire.",
  DESKTOP_DEVICE_LABEL_REQUIRED: "Le nom de ce poste est obligatoire.",
  DESKTOP_PAPOT_USER_REQUIRED: "Le nom de l’utilisateur PAPOT est obligatoire.",
  DESKTOP_NEXTCLOUD_AUTH_FAILED: "Le compte technique ou le mot de passe Nextcloud est incorrect.",
  DESKTOP_NEXTCLOUD_UNREACHABLE: "PAPOT n’arrive pas à joindre Nextcloud.",
  DESKTOP_NEXTCLOUD_INVALID_RESPONSE: "Nextcloud a répondu de manière inattendue.",
  DESKTOP_NEXTCLOUD_DAV_FAILED: "L’accès WebDAV Nextcloud ne fonctionne pas avec ce compte.",
  DESKTOP_NEXTCLOUD_SYNC_ROOT_FAILED: "PAPOT n’arrive pas à accéder au dossier PAPOT_SYNC.",
  DESKTOP_SECRET_STORE_UNAVAILABLE: "Le coffre sécurisé Windows n’est pas disponible sur ce poste.",
  DESKTOP_SECRET_ENCRYPTION_FAILED: "Le mot de passe Nextcloud n’a pas pu être chiffré.",
  DESKTOP_SETUP_FAILED: "La configuration n’a pas pu être enregistrée.",
};

export function DesktopSetupForm() {
  const [state, setState] = useState<SetupState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bridge = window.papotDesktop;
    if (!bridge) {
      setState({
        kind: "error",
        message: "Cet écran doit être ouvert depuis l’application PAPOT installée sur Windows.",
      });
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setState({ kind: "saving" });

    try {
      const result = await bridge.saveSetup({
        sharedDataPath: String(form.get("sharedDataPath") ?? ""),
        nextcloudBaseUrl: String(form.get("nextcloudBaseUrl") ?? ""),
        nextcloudLogin: String(form.get("nextcloudLogin") ?? ""),
        nextcloudAppPassword: String(form.get("nextcloudAppPassword") ?? ""),
        deviceLabel: String(form.get("deviceLabel") ?? ""),
        papotUserDisplayName: String(form.get("papotUserDisplayName") ?? ""),
      });

      if (!result.ok) {
        setState({
          kind: "error",
          message: errorMessages[result.error] ?? errorMessages.DESKTOP_SETUP_FAILED,
        });
        return;
      }

      formElement.reset();
      setState({
        kind: "success",
        message: `Poste « ${result.config.deviceLabel} » configuré. Nextcloud et le dossier partagé sont accessibles, et le mot de passe est chiffré dans le coffre Windows.`,
      });
      await bridge.finishSetup();
    } catch {
      setState({ kind: "error", message: errorMessages.DESKTOP_SETUP_FAILED });
    }
  }

  return (
    <form className="loginForm" onSubmit={handleSubmit}>
      <label>
        Chemin du dossier partagé de l’entreprise
        <input
          name="sharedDataPath"
          placeholder="\\\\SERVEUR\\PAPOT"
          autoComplete="off"
          disabled={state.kind === "saving" || state.kind === "success"}
          required
        />
      </label>

      <label>
        Adresse Nextcloud
        <input
          name="nextcloudBaseUrl"
          type="url"
          defaultValue="https://cloud.ideo-solutions.com"
          autoComplete="off"
          disabled={state.kind === "saving" || state.kind === "success"}
          required
        />
      </label>

      <label>
        Compte technique Nextcloud
        <input
          name="nextcloudLogin"
          placeholder="Papot_Appli"
          autoComplete="username"
          disabled={state.kind === "saving" || state.kind === "success"}
          required
        />
      </label>

      <label>
        Mot de passe d’application Nextcloud
        <input
          name="nextcloudAppPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Saisi une seule fois"
          disabled={state.kind === "saving" || state.kind === "success"}
          required
        />
      </label>

      <label>
        Nom de ce poste
        <input
          name="deviceLabel"
          placeholder="PC Lucien"
          autoComplete="off"
          disabled={state.kind === "saving" || state.kind === "success"}
          required
        />
      </label>

      <label>
        Utilisateur PAPOT
        <input
          name="papotUserDisplayName"
          placeholder="Lucien"
          autoComplete="off"
          disabled={state.kind === "saving" || state.kind === "success"}
          required
        />
      </label>

      <button
        className="primaryButton"
        type="submit"
        disabled={state.kind === "saving" || state.kind === "success"}
      >
        {state.kind === "saving" ? "Test en cours…" : "Tester et enregistrer"}
      </button>

      {state.kind === "error" ? <p className="formError">{state.message}</p> : null}
      {state.kind === "success" ? (
        <div className="panel" style={{ padding: 14 }}>
          <strong>Configuration enregistrée ✅</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {state.message}
          </p>
        </div>
      ) : null}
    </form>
  );
}
