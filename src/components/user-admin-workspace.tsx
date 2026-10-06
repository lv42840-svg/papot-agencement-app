"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AccessLevel = "READ" | "WRITE";
type ModuleDescriptor = { key: string; label: string; future?: boolean };
type SpecialDescriptor = { key: string; label: string; moduleKey: string };
type UserSession = {
  id: string;
  deviceId: string | null;
  deviceLabel: string | null;
  createdAt: string;
  expiresAt: string;
};
type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  isActive: boolean;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
  modulePermissions: Record<string, AccessLevel>;
  specialPermissions: string[];
  sessions: UserSession[];
};
type Snapshot = {
  users: ManagedUser[];
  modules: ModuleDescriptor[];
  specialPermissions: SpecialDescriptor[];
  actorUserId: string;
};
type MutationResponse = Snapshot & {
  setupUrl?: string;
  expiresAt?: string;
  error?: string;
};

function errorMessage(code: string) {
  if (code === "USER_EMAIL_EXISTS") return "Cette adresse e-mail est déjà utilisée.";
  if (code === "USERNAME_ALREADY_EXISTS") return "Cet identifiant est déjà utilisé.";
  if (code === "CANNOT_DISABLE_SELF") return "Vous ne pouvez pas désactiver votre propre compte.";
  if (code === "USER_NOT_FOUND") return "Utilisateur introuvable.";
  if (code === "ADMIN_FORBIDDEN") return "Administration des utilisateurs non autorisée.";
  if (code === "USER_ADMIN_REQUEST_INVALID") return "Certaines informations sont invalides.";
  return code || "Une erreur est survenue.";
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function UserAdminWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupLink, setSetupLink] = useState("");
  const [setupExpiresAt, setSetupExpiresAt] = useState("");

  async function load() {
    setError("");
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | (Snapshot & { error?: string })
      | null;
    if (!response.ok || !body) {
      setError(errorMessage(body?.error ?? "Chargement impossible."));
      return;
    }
    setSnapshot(body);
  }

  useEffect(() => {
    void load();
  }, []);

  async function mutate(input: Record<string, unknown>): Promise<MutationResponse | null> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => null)) as MutationResponse | null;
      if (!response.ok || !body) {
        setError(errorMessage(body?.error ?? "Modification impossible."));
        return null;
      }
      setSnapshot(body);
      return body;
    } finally {
      setBusy(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await mutate({
      action: "create",
      username: data.get("username"),
      displayName: data.get("displayName"),
      email: data.get("email"),
    });
    if (result?.setupUrl) {
      setSetupLink(result.setupUrl);
      setSetupExpiresAt(result.expiresAt ?? "");
      form.reset();
    }
  }

  async function copySetupLink() {
    if (!setupLink) return;
    const absolute = new URL(setupLink, window.location.origin).toString();
    await navigator.clipboard.writeText(absolute);
  }

  function showSetupLink(url: string, expiresAt?: string) {
    setSetupLink(url);
    setSetupExpiresAt(expiresAt ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!snapshot) {
    return (
      <section className="adminUsersPage">
        <div className="dashboardHeading">
          <div>
            <h1>Utilisateurs et droits</h1>
            <p className="muted">Chargement…</p>
          </div>
        </div>
        {error && <p className="formError">{error}</p>}
      </section>
    );
  }

  return (
    <section className="adminUsersPage">
      <div className="dashboardHeading">
        <div>
          <h1>Utilisateurs et droits</h1>
          <p className="muted">Comptes PAPOT, modules, droits spéciaux et sessions actives.</p>
        </div>
      </div>

      {error && (
        <p className="formError" role="alert">
          {error}
        </p>
      )}

      {setupLink ? (
        <article className="adminPanel adminSetupLink">
          <h2>Lien personnel de mot de passe</h2>
          <p className="muted">
            Usage unique. Le lien expire dans une heure et un nouveau lien invalide l’ancien.
          </p>
          <div className="adminSetupLinkRow">
            <input
              value={setupLink}
              readOnly
              aria-label="Lien d’activation ou de réinitialisation"
            />
            <button className="secondaryButton" type="button" onClick={() => void copySetupLink()}>
              Copier le lien
            </button>
          </div>
          {setupExpiresAt ? (
            <p className="muted">Valable jusqu’au {dateTime(setupExpiresAt)}.</p>
          ) : null}
        </article>
      ) : null}

      <article className="adminPanel">
        <h2>Ajouter un utilisateur</h2>
        <p className="muted">
          Créez le compte avec un identifiant court. PAPOT génère ensuite un lien personnel à usage
          unique pour que l’utilisateur choisisse lui-même son mot de passe.
        </p>
        <form className="adminCreateGrid" onSubmit={createUser}>
          <label>
            Identifiant
            <input
              name="username"
              required
              minLength={3}
              maxLength={80}
              pattern="[A-Za-z0-9._-]+"
              placeholder="prenom"
            />
          </label>
          <label>
            Nom affiché
            <input name="displayName" required maxLength={160} />
          </label>
          <label>
            Adresse e-mail
            <input name="email" type="email" required maxLength={240} />
          </label>
          <button className="primaryButton" type="submit" disabled={busy}>
            Créer l’utilisateur
          </button>
        </form>
      </article>

      <div className="adminUserList">
        {snapshot.users.map((user) => (
          <UserAdminCard
            key={user.id}
            user={user}
            actorUserId={snapshot.actorUserId}
            modules={snapshot.modules}
            specialPermissions={snapshot.specialPermissions}
            busy={busy}
            mutate={mutate}
            onSetupLink={showSetupLink}
          />
        ))}
      </div>

      <style jsx global>{`
        .adminUsersPage {
          display: grid;
          gap: 18px;
        }
        .adminPanel,
        .adminUserCard {
          background: #fff;
          border: 1px solid #e8e4f1;
          border-radius: 16px;
          box-shadow: 0 5px 18px rgb(55 39 112 / 0.06);
          padding: 18px;
        }
        .adminSetupLinkRow {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-top: 12px;
        }
        .adminSetupLinkRow input {
          min-width: 0;
          flex: 1;
          min-height: 40px;
          border: 1px solid #dcd6eb;
          border-radius: 10px;
          padding: 8px 10px;
          background: #faf9fd;
        }
        .adminPanel h2,
        .adminUserCard h2,
        .adminUserCard h3 {
          margin: 0 0 8px;
        }
        .adminCreateGrid,
        .adminProfileGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
          align-items: end;
          margin-top: 14px;
        }
        .adminCreateGrid label,
        .adminProfileGrid label,
        .adminResetForm label {
          display: grid;
          gap: 6px;
          font-size: 13px;
          font-weight: 650;
        }
        .adminCreateGrid input,
        .adminProfileGrid input,
        .adminResetForm input,
        .adminModuleRow select {
          min-height: 40px;
          border: 1px solid #dcd6eb;
          border-radius: 10px;
          padding: 8px 10px;
          background: #fff;
        }
        .adminUserList {
          display: grid;
          gap: 14px;
        }
        .adminUserHeader {
          display: flex;
          gap: 12px;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .adminBadges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .adminBadge {
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 11px;
          background: #f0edf8;
          color: #5e5479;
        }
        .adminBadge.isInactive {
          background: #f7e8e8;
          color: #8a3d3d;
        }
        .adminBadge.isWarning {
          background: #fff2d8;
          color: #865d0b;
        }
        .adminSection {
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid #eeeaf5;
        }
        .adminModuleGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 8px 14px;
        }
        .adminModuleRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 118px;
          gap: 10px;
          align-items: center;
        }
        .adminModuleLabel small {
          margin-left: 6px;
          font-weight: 600;
          color: #7769a4;
        }
        .adminSpecialGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 8px 14px;
          margin-top: 14px;
        }
        .adminCheck {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 13px;
        }
        .adminActions,
        .adminResetForm,
        .adminSessionRow {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          margin-top: 12px;
        }
        .adminResetForm label {
          min-width: min(100%, 300px);
          flex: 1;
        }
        .adminSessionList {
          display: grid;
          gap: 8px;
        }
        .adminSessionRow {
          justify-content: space-between;
          border-radius: 10px;
          background: #f8f7fb;
          padding: 10px 12px;
          font-size: 12px;
        }
        .adminSessionMeta {
          display: grid;
          gap: 2px;
        }
        .adminEmpty {
          color: #807a91;
          font-size: 13px;
        }
      `}</style>
    </section>
  );
}

function UserAdminCard({
  user,
  actorUserId,
  modules,
  specialPermissions,
  busy,
  mutate,
  onSetupLink,
}: {
  user: ManagedUser;
  actorUserId: string;
  modules: ModuleDescriptor[];
  specialPermissions: SpecialDescriptor[];
  busy: boolean;
  mutate: (input: Record<string, unknown>) => Promise<MutationResponse | null>;
  onSetupLink: (url: string, expiresAt?: string) => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [moduleAccess, setModuleAccess] = useState<Record<string, "NONE" | AccessLevel>>({});
  const [specials, setSpecials] = useState<Set<string>>(new Set());

  useEffect(() => {
    setUsername(user.username);
    setDisplayName(user.displayName);
    setEmail(user.email);
    setModuleAccess(
      Object.fromEntries(
        modules.map((module) => [module.key, user.modulePermissions[module.key] ?? "NONE"]),
      ),
    );
    setSpecials(new Set(user.specialPermissions));
  }, [modules, user]);

  const specialByModule = useMemo(() => {
    const grouped = new Map<string, SpecialDescriptor[]>();
    for (const permission of specialPermissions) {
      const values = grouped.get(permission.moduleKey) ?? [];
      values.push(permission);
      grouped.set(permission.moduleKey, values);
    }
    return grouped;
  }, [specialPermissions]);

  async function savePermissions() {
    await mutate({
      action: "replacePermissions",
      userId: user.id,
      modules: Object.entries(moduleAccess)
        .filter(([, access]) => access !== "NONE")
        .map(([moduleKey, accessLevel]) => ({ moduleKey, accessLevel })),
      specialPermissions: Array.from(specials),
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate({ action: "updateProfile", userId: user.id, username, displayName, email });
  }

  async function resetPassword() {
    const result = await mutate({
      action: "resetPassword",
      userId: user.id,
    });
    if (result?.setupUrl) onSetupLink(result.setupUrl, result.expiresAt);
  }

  return (
    <article className="adminUserCard">
      <div className="adminUserHeader">
        <div>
          <h2>{user.displayName}</h2>
          <p className="muted">
            @{user.username} · {user.email}
          </p>
        </div>
        <div className="adminBadges">
          <span className={`adminBadge${user.isActive ? "" : " isInactive"}`}>
            {user.isActive ? "Actif" : "Désactivé"}
          </span>
          {user.canManagePermissions && <span className="adminBadge">Administrateur</span>}
          {user.mustChangePassword && (
            <span className="adminBadge isWarning">Changement de mot de passe requis</span>
          )}
        </div>
      </div>

      <form className="adminProfileGrid" onSubmit={saveProfile}>
        <label>
          Identifiant
          <input
            value={username}
            minLength={3}
            maxLength={80}
            pattern="[A-Za-z0-9._-]+"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          Nom affiché
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Adresse e-mail
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button className="secondaryButton" type="submit" disabled={busy}>
          Enregistrer le profil
        </button>
      </form>

      <div className="adminActions">
        <button
          className="secondaryButton"
          type="button"
          disabled={busy || (user.id === actorUserId && user.isActive)}
          onClick={() =>
            void mutate({ action: "setActive", userId: user.id, isActive: !user.isActive })
          }
        >
          {user.isActive ? "Désactiver le compte" : "Réactiver le compte"}
        </button>
        {user.id === actorUserId && (
          <span className="muted">Votre compte ne peut pas être désactivé ici.</span>
        )}
      </div>

      <section className="adminSection">
        <h3>Droits par module</h3>
        {user.canManagePermissions ? (
          <p className="muted">
            Le droit d’administrer les utilisateurs est distinct des droits métier ci-dessous.
          </p>
        ) : null}
        <div className="adminModuleGrid">
          {modules.map((module) => (
            <label className="adminModuleRow" key={module.key}>
              <span className="adminModuleLabel">
                {module.label}
                {module.future && <small>préparé</small>}
              </span>
              <select
                value={moduleAccess[module.key] ?? "NONE"}
                onChange={(event) =>
                  setModuleAccess((current) => ({
                    ...current,
                    [module.key]: event.target.value as "NONE" | AccessLevel,
                  }))
                }
              >
                <option value="NONE">Aucun</option>
                <option value="READ">Lecture</option>
                <option value="WRITE">Modification</option>
              </select>
            </label>
          ))}
        </div>

        <div className="adminSpecialGrid">
          {Array.from(specialByModule.entries()).flatMap(([moduleKey, permissions]) =>
            permissions.map((permission) => (
              <label className="adminCheck" key={permission.key}>
                <input
                  type="checkbox"
                  checked={specials.has(permission.key)}
                  onChange={(event) => {
                    setSpecials((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(permission.key);
                      else next.delete(permission.key);
                      return next;
                    });
                  }}
                />
                <span>
                  {permission.label} <small className="muted">({moduleKey})</small>
                </span>
              </label>
            )),
          )}
        </div>

        <div className="adminActions">
          <button
            className="primaryButton"
            type="button"
            disabled={busy}
            onClick={() => void savePermissions()}
          >
            Enregistrer les droits
          </button>
        </div>
      </section>

      <section className="adminSection">
        <h3>Réinitialisation du mot de passe</h3>
        <p className="muted">
          Génère un nouveau lien personnel valable une heure. Les sessions actuelles sont révoquées
          et l’ancien lien devient inutilisable.
        </p>
        <button
          className="secondaryButton"
          type="button"
          disabled={busy || !user.isActive}
          onClick={() => void resetPassword()}
        >
          Générer un lien de réinitialisation
        </button>
      </section>

      <section className="adminSection">
        <h3>Sessions actives</h3>
        {user.sessions.length === 0 ? (
          <p className="adminEmpty">Aucune session active.</p>
        ) : (
          <div className="adminSessionList">
            {user.sessions.map((session) => (
              <div className="adminSessionRow" key={session.id}>
                <div className="adminSessionMeta">
                  <strong>{session.deviceLabel ?? "Session PAPOT"}</strong>
                  <span>
                    {session.deviceId ? `Poste ${session.deviceId} · ` : ""}
                    créée {dateTime(session.createdAt)} · expire {dateTime(session.expiresAt)}
                  </span>
                </div>
                <button
                  className="secondaryButton"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutate({
                      action: "revokeSession",
                      userId: user.id,
                      sessionId: session.id,
                    })
                  }
                >
                  Révoquer
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
