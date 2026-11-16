"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  CustomerCatalog,
  CustomerCatalogItem,
} from "@/lib/pennylane/customer-import-store";

type ResponseData = CustomerCatalog & { canWrite: boolean; error?: string };

function explain(code: string): string {
  const explanations: Record<string, string> = {
    PENNYLANE_DISABLED: "La connexion Pennylane n'est pas encore activée sur le serveur.",
    PENNYLANE_NOT_CONFIGURED: "La clé Pennylane n'est pas encore enregistrée.",
    PENNYLANE_CLIENT_LINK_REQUIRED: "Client probablement déjà présent dans PAPOT. Rattache la bonne fiche au lieu de créer un doublon.",
    PENNYLANE_CLIENT_SIRET_CONFLICT: "Le SIRET de cette fiche PAPOT est différent. Corrige d'abord l'identité dans Pennylane ou choisis une autre fiche.",
    PENNYLANE_CLIENT_LINK_CONFLICT: "Cette fiche est déjà liée à un autre identifiant Pennylane.",
    PENNYLANE_CUSTOMER_DATA_INVALID: "La fiche Pennylane est incomplète ou invalide : corrige-la dans Pennylane, puis actualise.",
    PENNYLANE_CUSTOMER_NOT_IMPORTED: "Cette fiche n'existe plus dans l'import Pennylane. Actualise la liste.",
    CLIENTS_VERSION_CONFLICT: "La fiche PAPOT vient de changer. Recharge la liste avant de réessayer.",
    CLIENT_SIRET_EXISTS: "Ce SIRET existe déjà dans PAPOT. Rattache le client existant.",
  };
  return explanations[code] ?? "Opération impossible (" + code + ").";
}

const statusText: Record<CustomerCatalogItem["status"], string> = {
  NEW: "À importer",
  MATCH: "Rapprochement nécessaire",
  LINKED: "Lié à PAPOT",
  INVALID: "Fiche à corriger",
};

export function PennylaneClientsWorkspace() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusedClientId, setFocusedClientId] = useState("");

  async function load() {
    const response = await fetch("/api/desktop/clients/pennylane", { cache: "no-store" });
    const result = await response.json() as ResponseData;
    if (!response.ok) throw new Error(result.error ?? "PENNYLANE_CLIENT_FAILED");
    setData(result);
    setSelectedId(prev => result.customers.some(customer => customer.id === prev)
      ? prev : result.customers[0]?.id ?? "");
  }

  useEffect(() => {
    void load().catch(reason => setError(
      explain(reason instanceof Error ? reason.message : "PENNYLANE_CLIENT_FAILED"),
    ));
  }, []);

  const filtered = useMemo(
    () => (data?.customers ?? []).filter(customer =>
      [customer.name, customer.siret, customer.email, customer.id]
        .join(" ").toLocaleLowerCase("fr-FR").includes(search.toLocaleLowerCase("fr-FR")),
    ),
    [data, search],
  );
  const selected = data?.customers.find(customer => customer.id === selectedId) ?? null;
  const possible = selected?.potentialMatches ?? [];
  const choices = (data?.existingClients ?? []).filter(client =>
    !client.pennylaneId || client.pennylaneId === selected?.id,
  ).filter(client =>
    [client.name, client.siret].join(" ").toLocaleLowerCase("fr-FR")
      .includes(matchSearch.toLocaleLowerCase("fr-FR")),
  ).slice(0, 70);

  async function mutate(action: "REFRESH" | "IMPORT" | "LINK") {
    if (busy) return;
    if (action === "LINK" && !clientId) {
      setError("Sélectionne d'abord la fiche PAPOT à conserver.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setFocusedClientId("");
    try {
      const payload = action === "REFRESH" ? { action }
        : action === "LINK"
          ? { action, customerId: selected?.id, clientId }
          : { action, customerId: selected?.id };
      const response = await fetch("/api/desktop/clients/pennylane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as {
        error?: string; clientId?: string; action?: "CREATED" | "LINKED" | "UPDATED"; count?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "PENNYLANE_CLIENT_FAILED");
      await load();
      setFocusedClientId(result.clientId ?? "");
      setNotice(action === "REFRESH"
        ? (result.count ?? 0) + " clients lus dans Pennylane. Aucune fiche PAPOT n'a été modifiée."
        : result.action === "CREATED"
          ? "Client importé dans PAPOT."
          : result.action === "LINKED"
            ? "Fiche existante conservée et liée à Pennylane, sans changer son identifiant."
            : "Identité du client actualisée depuis Pennylane. Notes et contacts internes préservés.");
    } catch (cause) {
      setError(explain(cause instanceof Error ? cause.message : "PENNYLANE_CLIENT_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 20, maxWidth: 1500, margin: "0 auto", display: "grid", gap: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div>
          <h1>Clients · Pennylane</h1>
          <p>Les clients naissent dans Pennylane. PAPOT conserve ses affaires, devis et chantiers lors du rattachement.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="secondaryButton" href="/clients">Retour au fichier clients</Link>
          <button className="primaryButton" type="button"
            disabled={busy || !data?.enabled || !data?.canWrite}
            onClick={() => void mutate("REFRESH")}>Actualiser les clients Pennylane</button>
        </div>
      </header>
      {error ? <p role="alert" style={{ color: "#a92e3b" }}>{error}</p> : null}
      {notice ? (
        <p role="status">{notice}{" "}
          {focusedClientId ? <Link href={"/clients?focus=" + encodeURIComponent(focusedClientId)}>
            Voir le client dans PAPOT
          </Link> : null}
        </p>
      ) : null}
      {data && !data.enabled ? (
        <section className="panel" style={{ padding: 20 }}>
          <h2>Connexion Pennylane en attente</h2>
          <p>Enregistre et teste la nouvelle clé dans Paramètres → Pennylane. L'import reste désactivé tant que l'activation serveur n'est pas effectuée.</p>
          <Link className="secondaryButton" href="/settings/pennylane">Configurer la connexion</Link>
        </section>
      ) : null}
      {data?.enabled ? (
        <>
          <p style={{ fontSize: 13, color: "#68637b" }}>
            Dernière lecture : {data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString("fr-FR") : "Jamais"}.
            {" "}{data.count} fiche(s) dans l'import.
            {data.truncated ? " Affichage limité à 2 000 clients : recherche paginée à prévoir." : ""}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(350px, 1.4fr)", gap: 16, alignItems: "start" }}>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 10 }}>
              <h2>Clients Pennylane ({filtered.length})</h2>
              <input aria-label="Rechercher dans Pennylane" value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Nom, SIRET, e-mail…" />
              <div style={{ maxHeight: "65vh", overflow: "auto", display: "grid", gap: 6 }}>
                {filtered.map(customer => (
                  <button type="button" key={customer.id} onClick={() => {
                    setSelectedId(customer.id);
                    setMatchSearch("");
                    setClientId(customer.potentialMatches.length === 1 ? customer.potentialMatches[0].id : "");
                    setError("");
                  }} style={{
                    textAlign: "left", background: selectedId === customer.id ? "#eee8fa" : "#faf9fc",
                    border: "1px solid #ded8ed", borderRadius: 8, padding: 10,
                    cursor: "pointer", display: "grid", gap: 3,
                  }}>
                    <strong>{customer.name}</strong>
                    <small>{customer.siret || "SIRET non renseigné"} · {customer.email || "Sans e-mail"}</small>
                    <small>{statusText[customer.status]}</small>
                  </button>
                ))}
              </div>
              {data.synced && filtered.length === 0 ? <p>Aucun client correspondant.</p> : null}
              {!data.synced ? <p>La liste est vide avant le premier import. Clique sur Actualiser.</p> : null}
            </section>
            <section className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
              {!selected ? <p>Sélectionne un client dans la liste.</p> : (
                <>
                  <h2>{selected.name}</h2>
                  <p>Référence Pennylane : {selected.id}<br />
                    {selected.siret ? "SIRET : " + selected.siret : "SIRET non disponible"}
                  </p>
                  <strong>{statusText[selected.status]}</strong>
                  {selected.status === "INVALID" ? (
                    <p>Cette fiche ne contient pas une identité exploitable. Corrige-la dans Pennylane puis actualise.</p>
                  ) : selected.status === "LINKED" ? (
                    <>
                      <p>Ce client est déjà lié à PAPOT. Tu peux récupérer ses nouvelles coordonnées sans changer son identifiant ni ses données internes.</p>
                      <button type="button" className="primaryButton"
                        disabled={busy || !data.canWrite} onClick={() => void mutate("IMPORT")}>
                        Mettre à jour depuis Pennylane
                      </button>
                      {selected.linkedClientId ? <Link href={"/clients?focus=" + encodeURIComponent(selected.linkedClientId)}>
                        Voir la fiche PAPOT existante
                      </Link> : null}
                    </>
                  ) : (
                    <>
                      {possible.length > 0 ? (
                        <p style={{ color: "#98472b" }}>
                          {possible.length} fiche(s) ressemblante(s) dans PAPOT. Vérifie le rapprochement pour éviter de créer un doublon.
                        </p>
                      ) : <p>Aucune fiche de même SIRET ou de même nom trouvée. Tu peux importer ce client.</p>}
                      <h3>Rattacher à une fiche PAPOT existante</h3>
                      <label>Rechercher une fiche PAPOT
                        <input value={matchSearch} onChange={event => {
                          setMatchSearch(event.target.value); setClientId("");
                        }} placeholder="Nom ou SIRET PAPOT" />
                      </label>
                      <label>Fiche PAPOT à conserver
                        <select value={clientId} disabled={busy || !data.canWrite}
                          onChange={event => setClientId(event.target.value)}>
                          <option value="">Choisir une fiche existante</option>
                          {choices.map(client => (
                            <option key={client.id} value={client.id}>
                              {client.name}{client.siret ? " · " + client.siret : ""}
                              {client.archived ? " (archivé)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {possible.length > 0 ? (
                        <p style={{ fontSize: 13 }}>
                          Rapprochements suggérés : {possible.map(item => item.name + (item.siret ? " (" + item.siret + ")" : "")).join(", ")}
                        </p>
                      ) : null}
                      <button type="button" className="primaryButton"
                        disabled={busy || !data.canWrite || !clientId}
                        onClick={() => void mutate("LINK")}>Conserver cette fiche PAPOT et la lier</button>
                      {selected.status === "NEW" ? (
                        <button type="button" className="secondaryButton"
                          disabled={busy || !data.canWrite}
                          onClick={() => void mutate("IMPORT")}>Importer comme nouveau client PAPOT</button>
                      ) : null}
                      <small>Le rattachement conserve l'UUID PAPOT et les affaires associées. Seules les coordonnées comptables sont actualisées.</small>
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      ) : null}
    </main>
  );
}
