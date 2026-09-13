"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  FileText,
  FolderOpen,
  PlayCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommercialCase, CommercialPayload } from "@/lib/commercial/domain";
import {
  CHANTIER_STATUS_LABELS,
  type ChantierRecord,
  type ChantiersPayload,
} from "@/lib/chantiers/domain";
import type { ChantierCapabilities } from "@/lib/chantiers/mutations";

type ChantiersSnapshot = {
  payload: ChantiersPayload;
  actor: { userId: string; displayName: string };
  capabilities: ChantierCapabilities;
  focusChantierId?: string;
  serverNow: string;
};

type CommercialSnapshot = {
  payload: CommercialPayload;
};

type ViewMode = "ACTIVE" | "DONE" | "ARCHIVED";

const errorMessages: Record<string, string> = {
  DESKTOP_RUNTIME_NOT_CONFIGURED: "Le poste PAPOT n'est pas configuré.",
  CHANTIERS_LOCKED:
    "Les chantiers sont modifiés sur un autre poste. Réessaie dans quelques secondes.",
  CHANTIERS_VERSION_CONFLICT:
    "Les chantiers ont changé sur un autre poste. Actualise puis réessaie.",
  CHANTIER_ALREADY_LAUNCHED: "Cette affaire a déjà été lancée en chantier.",
  CHANTIER_COMMERCIAL_NOT_CONFIRMED: "L'affaire doit être confirmée avant le lancement chantier.",
  CHANTIER_INSTALL_DATE_REQUIRED: "La date prévisionnelle de pose est obligatoire.",
  CHANTIER_QUOTE_DECLARATION_REQUIRED: "Indique explicitement que tu n'as pas le devis client.",
  CHANTIER_SIGNED_QUOTE_DECLARATION_REQUIRED:
    "Indique explicitement que tu n'as pas le devis signé.",
  CHANTIER_COSTING_DECLARATION_REQUIRED: "Indique explicitement que tu n'as pas le déboursé OBAT.",
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("fr-FR");
}

function formatDateOnly(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function matches(item: ChantierRecord, query: string): boolean {
  if (!query) return true;
  return [item.name, item.number, item.reference, item.clientName, item.companyName, item.siteLabel]
    .filter(Boolean)
    .some((value) => normalize(String(value)).includes(query));
}

function statusClass(item: ChantierRecord): string {
  if (item.status === "DONE") return "done";
  if (item.status === "ARCHIVED") return "archived";
  return "active";
}

export function ChantiersWorkspace() {
  const router = useRouter();
  const [chantiersSnapshot, setChantiersSnapshot] = useState<ChantiersSnapshot | null>(null);
  const [commercialSnapshot, setCommercialSnapshot] = useState<CommercialSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("ACTIVE");
  const [query, setQuery] = useState("");
  const [launchCaseId, setLaunchCaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chantiersResponse, commercialResponse] = await Promise.all([
        fetch("/api/desktop/chantiers", { cache: "no-store" }),
        fetch("/api/desktop/commercial", { cache: "no-store" }),
      ]);
      const chantiersBody = (await chantiersResponse.json()) as ChantiersSnapshot & {
        error?: string;
      };
      const commercialBody = (await commercialResponse.json()) as CommercialSnapshot & {
        error?: string;
      };
      if (!chantiersResponse.ok) throw new Error(chantiersBody.error ?? "CHANTIERS_LOAD_FAILED");
      if (!commercialResponse.ok) throw new Error(commercialBody.error ?? "COMMERCIAL_LOAD_FAILED");
      setChantiersSnapshot(chantiersBody);
      setCommercialSnapshot(commercialBody);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : "CHANTIERS_LOAD_FAILED";
      setError(errorMessages[code] ?? "Impossible de charger les chantiers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chantiers = useMemo(() => chantiersSnapshot?.payload.chantiers ?? [], [chantiersSnapshot]);
  const launchedCommercialIds = useMemo(
    () => new Set(chantiers.map((item) => item.sourceCommercialCaseId)),
    [chantiers],
  );
  const launchCandidates = useMemo(
    () =>
      (commercialSnapshot?.payload.cases ?? []).filter(
        (item) => item.status === "CONFIRMED" && !launchedCommercialIds.has(item.id),
      ),
    [commercialSnapshot, launchedCommercialIds],
  );

  const normalizedQuery = normalize(query);
  const visible = useMemo(() => {
    const filtered = chantiers.filter((item) => matches(item, normalizedQuery));
    if (normalizedQuery) return filtered;
    return filtered.filter((item) => item.status === mode);
  }, [chantiers, normalizedQuery, mode]);

  const selectedLaunch = launchCandidates.find((item) => item.id === launchCaseId) ?? null;
  const counts = {
    active: chantiers.filter((item) => item.status === "ACTIVE").length,
    done: chantiers.filter((item) => item.status === "DONE").length,
    archived: chantiers.filter((item) => item.status === "ARCHIVED").length,
  };

  async function launch(body: {
    commercialCaseId: string;
    quoteMissingDeclared: boolean;
    signedQuoteMissingDeclared: boolean;
    costingMissingDeclared: boolean;
    be: number;
    workshop: number;
    install: number;
  }) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/desktop/chantiers/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ChantiersSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "CHANTIER_LAUNCH_FAILED");
      setChantiersSnapshot(result);
      setLaunchCaseId(null);
      if (result.focusChantierId) router.push(`/chantiers/${result.focusChantierId}`);
    } catch (launchError) {
      const code = launchError instanceof Error ? launchError.message : "CHANTIER_LAUNCH_FAILED";
      setError(errorMessages[code] ?? "Le chantier n'a pas pu être lancé.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chantiersWorkspace">
      <section className="chantiersHeading">
        <div>
          <h1>Chantiers</h1>
          <p>Affaires lancées, suivi opérationnel et cycle Actif → Terminé → Archivé.</p>
        </div>
        <button
          className="chantiersRefresh"
          type="button"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw size={14} /> Actualiser
        </button>
      </section>

      {error ? <div className="chantiersError">{error}</div> : null}

      <section className="chantiersSummary">
        <SummaryCard icon={FolderOpen} label="Actifs" value={counts.active} />
        <SummaryCard icon={CheckCircle2} label="Terminés" value={counts.done} />
        <SummaryCard icon={Archive} label="Archivés" value={counts.archived} />
        <SummaryCard icon={PlayCircle} label="À lancer" value={launchCandidates.length} accent />
      </section>

      {launchCandidates.length > 0 ? (
        <section className="chantiersLaunchPanel">
          <div className="chantiersLaunchHeader">
            <div>
              <strong>Affaires confirmées à lancer</strong>
              <span>
                La feuille de lancement crée la structure chantier sans recréer l&apos;affaire
                commerciale.
              </span>
            </div>
          </div>
          <div className="chantiersLaunchList">
            {launchCandidates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={launchCaseId === item.id ? "isSelected" : undefined}
                onClick={() => setLaunchCaseId((current) => (current === item.id ? null : item.id))}
              >
                <span>
                  <BriefcaseBusiness size={14} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {[item.clientName, item.siteLabel].filter(Boolean).join(" · ") ||
                      "Client / lieu à compléter"}
                  </small>
                </div>
                <em>
                  {item.plannedInstallDate
                    ? formatDateOnly(item.plannedInstallDate)
                    : "Pose à compléter"}
                </em>
              </button>
            ))}
          </div>
          {selectedLaunch ? (
            <LaunchSheet
              item={selectedLaunch}
              busy={busy}
              onCancel={() => setLaunchCaseId(null)}
              onLaunch={launch}
            />
          ) : null}
        </section>
      ) : null}

      <section className="chantiersToolbar">
        <div className="chantiersModes">
          <button
            className={mode === "ACTIVE" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("ACTIVE")}
          >
            Actifs
          </button>
          <button
            className={mode === "DONE" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("DONE")}
          >
            Terminés
          </button>
          <button
            className={mode === "ARCHIVED" ? "isActive" : ""}
            type="button"
            onClick={() => setMode("ARCHIVED")}
          >
            Archives
          </button>
        </div>
        <label className="chantiersSearch">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom, numéro, référence, client, société, lieu…"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          ) : null}
        </label>
      </section>

      {loading && !chantiersSnapshot ? (
        <div className="chantiersEmpty">
          <RefreshCw className="chantiersSpin" size={20} /> Chargement des chantiers…
        </div>
      ) : visible.length === 0 ? (
        <div className="chantiersEmpty">
          <FolderOpen size={31} />
          <strong>
            {normalizedQuery ? "Aucun chantier correspondant" : "Aucun chantier dans cette vue"}
          </strong>
          <span>
            {normalizedQuery
              ? "La recherche interroge aussi les chantiers archivés."
              : "Les affaires confirmées à lancer apparaissent au-dessus."}
          </span>
        </div>
      ) : (
        <div className="chantiersTable">
          {visible.map((item) => (
            <Link key={item.id} href={`/chantiers/${item.id}`} className="chantiersRow">
              <span className={`chantierStatus chantierStatus-${statusClass(item)}`}>
                {CHANTIER_STATUS_LABELS[item.status]}
              </span>
              <div className="chantiersRowMain">
                <strong>{item.name}</strong>
                <span>
                  {[item.clientName, item.companyName, item.siteLabel]
                    .filter(Boolean)
                    .join(" · ") || "Client / lieu à compléter"}
                </span>
              </div>
              <div className="chantiersRowRefs">
                <span>{item.number || "N° à compléter"}</span>
                <small>{item.reference || "Référence à compléter"}</small>
              </div>
              <div className="chantiersRowDate">
                <CalendarClock size={13} />
                <span>{formatDateOnly(item.plannedInstallDate)}</span>
              </div>
              <FileText size={15} className="chantiersRowArrow" />
            </Link>
          ))}
        </div>
      )}

      <ChantiersStyles />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof FolderOpen;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "isAccent" : undefined}>
      <span>
        <Icon size={17} />
      </span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function LaunchSheet({
  item,
  busy,
  onCancel,
  onLaunch,
}: {
  item: CommercialCase;
  busy: boolean;
  onCancel: () => void;
  onLaunch: (body: {
    commercialCaseId: string;
    quoteMissingDeclared: boolean;
    signedQuoteMissingDeclared: boolean;
    costingMissingDeclared: boolean;
    be: number;
    workshop: number;
    install: number;
  }) => Promise<void>;
}) {
  const quotePresent = item.documents.some((document) => document.category === "QUOTE");
  const signedQuotePresent = item.documents.some(
    (document) => document.category === "QUOTE" && document.isSignedQuote,
  );
  const costingPresent = item.documents.some((document) => document.category === "COSTING");
  const [quoteMissing, setQuoteMissing] = useState(false);
  const [signedQuoteMissing, setSignedQuoteMissing] = useState(false);
  const [costingMissing, setCostingMissing] = useState(false);
  const [be, setBe] = useState(String(item.provisionHours.be));
  const [workshop, setWorkshop] = useState(String(item.provisionHours.workshop));
  const [install, setInstall] = useState(String(item.provisionHours.install));

  const declarationsOk =
    (quotePresent || quoteMissing) &&
    (signedQuotePresent || signedQuoteMissing) &&
    (costingPresent || costingMissing);

  return (
    <div className="launchSheet">
      <div className="launchSheetTitle">
        <div>
          <strong>Feuille de lancement · {item.name}</strong>
          <span>
            Les informations déjà connues sont reprises. Les absences doivent être déclarées
            explicitement.
          </span>
        </div>
        <button type="button" onClick={onCancel}>
          <X size={15} />
        </button>
      </div>

      <div className="launchDocuments">
        <LaunchDocument
          label="Devis client"
          present={quotePresent}
          checked={quoteMissing}
          onChange={setQuoteMissing}
        />
        <LaunchDocument
          label="Devis signé"
          present={signedQuotePresent}
          checked={signedQuoteMissing}
          onChange={setSignedQuoteMissing}
        />
        <LaunchDocument
          label="Déboursé OBAT"
          present={costingPresent}
          checked={costingMissing}
          onChange={setCostingMissing}
        />
      </div>

      <div className="launchHours">
        <label>
          <span>BE (h)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={be}
            onChange={(event) => setBe(event.target.value)}
          />
        </label>
        <label>
          <span>Atelier (h)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={workshop}
            onChange={(event) => setWorkshop(event.target.value)}
          />
        </label>
        <label>
          <span>Pose (h)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={install}
            onChange={(event) => setInstall(event.target.value)}
          />
        </label>
      </div>
      <p className="launchHint">
        Les heures sont initialisées depuis la charge commerciale lorsqu&apos;elle existe.
        L&apos;import automatique du déboursé OBAT sera raccordé au parseur dédié, sans double
        saisie à terme.
      </p>

      <button
        type="button"
        className="primaryButton launchButton"
        disabled={busy || !declarationsOk}
        onClick={() =>
          void onLaunch({
            commercialCaseId: item.id,
            quoteMissingDeclared: !quotePresent && quoteMissing,
            signedQuoteMissingDeclared: !signedQuotePresent && signedQuoteMissing,
            costingMissingDeclared: !costingPresent && costingMissing,
            be: Number(be || 0),
            workshop: Number(workshop || 0),
            install: Number(install || 0),
          })
        }
      >
        <PlayCircle size={15} /> Lancer le chantier
      </button>
    </div>
  );
}

function LaunchDocument({
  label,
  present,
  checked,
  onChange,
}: {
  label: string;
  present: boolean;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={present ? "isPresent" : "isMissing"}>
      <strong>{label}</strong>
      {present ? (
        <span>
          <CheckCircle2 size={13} /> Déjà présent
        </span>
      ) : (
        <label>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />{" "}
          Je n&apos;ai pas
        </label>
      )}
    </div>
  );
}

function ChantiersStyles() {
  return (
    <style jsx global>{`
      .chantiersWorkspace {
        display: grid;
        gap: 15px;
        width: 100%;
      }
      .chantiersHeading {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
      }
      .chantiersHeading h1 {
        margin: 0 0 4px;
        font-size: 27px;
      }
      .chantiersHeading p {
        margin: 0;
        color: var(--muted);
        font-size: 11px;
      }
      .chantiersRefresh {
        min-height: 36px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #ddd9e8;
        border-radius: 8px;
        background: white;
        color: #5c5765;
      }
      .chantiersError {
        padding: 10px 12px;
        border: 1px solid #efc4bc;
        border-radius: 9px;
        background: #fff5f3;
        color: #a3493a;
        font-size: 11px;
      }
      .chantiersSummary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
      }
      .chantiersSummary > div {
        min-height: 72px;
        padding: 11px 13px;
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-rows: auto auto;
        column-gap: 9px;
        align-content: center;
        border: 1px solid #e7e3ed;
        border-radius: 10px;
        background: white;
      }
      .chantiersSummary > div > span {
        grid-row: 1/3;
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 9px;
        background: #f1edff;
        color: #6c58c8;
      }
      .chantiersSummary strong {
        font-size: 20px;
        line-height: 1;
      }
      .chantiersSummary small {
        color: #85808e;
        font-size: 9px;
        font-weight: 700;
      }
      .chantiersSummary .isAccent {
        border-color: #d5c9ff;
        background: #fbf9ff;
      }
      .chantiersLaunchPanel {
        padding: 13px;
        display: grid;
        gap: 10px;
        border: 1px solid #ded6f1;
        border-radius: 11px;
        background: white;
      }
      .chantiersLaunchHeader > div {
        display: grid;
        gap: 2px;
      }
      .chantiersLaunchHeader strong {
        font-size: 12px;
      }
      .chantiersLaunchHeader span {
        color: #8b8692;
        font-size: 9px;
      }
      .chantiersLaunchList {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 7px;
      }
      .chantiersLaunchList > button {
        padding: 9px 10px;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #ebe6f2;
        border-radius: 9px;
        background: #fdfcff;
        text-align: left;
        color: inherit;
      }
      .chantiersLaunchList > button:hover,
      .chantiersLaunchList > button.isSelected {
        border-color: #a895e9;
        background: #f6f2ff;
      }
      .chantiersLaunchList > button > span {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: #eee9ff;
        color: #6b57c8;
      }
      .chantiersLaunchList > button > div {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .chantiersLaunchList > button strong {
        overflow: hidden;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersLaunchList > button small {
        overflow: hidden;
        color: #8d8794;
        font-size: 8px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersLaunchList > button em {
        color: #7a7384;
        font-size: 8px;
        font-style: normal;
        white-space: nowrap;
      }
      .launchSheet {
        padding: 12px;
        display: grid;
        gap: 10px;
        border: 1px solid #e6e0f0;
        border-radius: 9px;
        background: #faf8ff;
      }
      .launchSheetTitle {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .launchSheetTitle > div {
        display: grid;
        gap: 2px;
      }
      .launchSheetTitle strong {
        font-size: 11px;
      }
      .launchSheetTitle span {
        color: #89828f;
        font-size: 8.5px;
      }
      .launchSheetTitle > button {
        border: 0;
        background: transparent;
        color: #7e7588;
      }
      .launchDocuments {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
      }
      .launchDocuments > div {
        padding: 9px;
        display: grid;
        gap: 5px;
        border: 1px solid #e6e1ec;
        border-radius: 8px;
        background: white;
      }
      .launchDocuments strong {
        font-size: 9px;
      }
      .launchDocuments span,
      .launchDocuments label {
        display: flex;
        align-items: center;
        gap: 5px;
        color: #6f6877;
        font-size: 8px;
      }
      .launchDocuments .isPresent {
        border-color: #cfe7d7;
        background: #f7fcf9;
      }
      .launchDocuments .isPresent span {
        color: #3d855a;
      }
      .launchDocuments .isMissing {
        border-color: #ebd9bf;
        background: #fffaf2;
      }
      .launchHours {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .launchHours label {
        display: grid;
        gap: 4px;
      }
      .launchHours span {
        color: #5e5965;
        font-size: 9px;
        font-weight: 750;
      }
      .launchHours input {
        width: 100%;
        padding: 8px 9px;
        border: 1px solid #ddd9e5;
        border-radius: 8px;
        background: white;
      }
      .launchHint {
        margin: 0;
        color: #8d8794;
        font-size: 8.5px;
      }
      .launchButton {
        width: max-content;
      }
      .chantiersToolbar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .chantiersModes {
        display: flex;
        gap: 5px;
      }
      .chantiersModes button {
        min-height: 31px;
        padding: 0 10px;
        border: 1px solid #e0dce8;
        border-radius: 7px;
        background: white;
        color: #6c6675;
        font-size: 10px;
      }
      .chantiersModes button.isActive {
        border-color: #9d8be7;
        background: #f1edff;
        color: #6551c7;
        font-weight: 800;
      }
      .chantiersSearch {
        width: min(560px, 50vw);
        min-height: 34px;
        padding: 0 9px;
        display: flex;
        align-items: center;
        gap: 7px;
        border: 1px solid #ded9e6;
        border-radius: 8px;
        background: white;
        color: #8a8592;
      }
      .chantiersSearch input {
        min-width: 0;
        flex: 1;
        border: 0;
        outline: 0;
        font: inherit;
        font-size: 10px;
      }
      .chantiersSearch button {
        padding: 0;
        border: 0;
        background: transparent;
        color: #8a8592;
      }
      .chantiersEmpty {
        min-height: 330px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
        color: #8a8592;
        font-size: 10px;
        text-align: center;
      }
      .chantiersEmpty strong {
        color: #59535f;
        font-size: 13px;
      }
      .chantiersTable {
        overflow: hidden;
        border: 1px solid #e8e4ef;
        border-radius: 12px;
        background: white;
      }
      .chantiersRow {
        min-height: 66px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 74px minmax(220px, 1.6fr) minmax(130px, 0.7fr) minmax(
            120px,
            0.55fr
          ) 20px;
        gap: 10px;
        align-items: center;
        border-bottom: 1px solid #f0edf4;
        color: inherit;
        text-decoration: none;
      }
      .chantiersRow:last-child {
        border-bottom: 0;
      }
      .chantiersRow:hover {
        background: #fbf9ff;
      }
      .chantierStatus {
        width: max-content;
        padding: 4px 7px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 800;
      }
      .chantierStatus-active {
        background: #e9f7ee;
        color: #378058;
      }
      .chantierStatus-done {
        background: #eef2fa;
        color: #546e9d;
      }
      .chantierStatus-archived {
        background: #ece9ed;
        color: #706a74;
      }
      .chantiersRowMain,
      .chantiersRowRefs {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .chantiersRowMain strong {
        overflow: hidden;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersRowMain span,
      .chantiersRowRefs span,
      .chantiersRowRefs small {
        overflow: hidden;
        color: #8c8793;
        font-size: 8.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantiersRowDate {
        display: flex;
        align-items: center;
        gap: 5px;
        color: #706979;
        font-size: 8.5px;
      }
      .chantiersRowArrow {
        color: #9b90b0;
      }
      .chantiersSpin {
        animation: chantiersSpin 1s linear infinite;
      }
      @keyframes chantiersSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 1000px) {
        .chantiersSummary {
          grid-template-columns: 1fr 1fr;
        }
        .chantiersRow {
          grid-template-columns: 70px minmax(200px, 1fr) minmax(110px, 0.6fr);
        }
        .chantiersRowDate,
        .chantiersRowArrow {
          display: none;
        }
        .launchDocuments {
          grid-template-columns: 1fr 1fr 1fr;
        }
      }
      @media (max-width: 760px) {
        .chantiersHeading,
        .chantiersToolbar {
          flex-direction: column;
        }
        .chantiersSearch {
          width: 100%;
        }
        .chantiersRow {
          grid-template-columns: 65px minmax(0, 1fr);
        }
        .chantiersRowRefs {
          grid-column: 2;
        }
        .launchDocuments,
        .launchHours {
          grid-template-columns: 1fr;
        }
        .chantiersLaunchList {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
