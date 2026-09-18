"use client";

import {
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Factory,
  FolderOpen,
  Mail,
  Plus,
  Save,
  Users,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  BE_STATUS_LABELS,
  CHANTIER_OPERATIONAL_SPACES,
  INSTALL_STATUS_LABELS,
  WORKSHOP_STATUS_LABELS,
  type BeItem,
  type BeItemStatus,
  type ChantierRecord,
  type ChantierTs,
  type InstallItem,
  type InstallItemStatus,
  type TechnicalOrigin,
  type WorkshopItem,
  type WorkshopItemStatus,
} from "@/lib/chantiers/domain";
import type { CommercialCase } from "@/lib/commercial/domain";
import {
  chantierQuoteLineDisplay,
  retainedChantierQuoteLines,
  retainedChantierQuotes,
  type ChantierQuoteLineReference,
  type ChantierRetainedQuote,
} from "@/lib/chantiers/quote-links";
import { quoteCanBeRetained } from "@/lib/quotes/retention";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type MutationBody = Record<string, unknown> & { action: string };
type Mutate = (body: MutationBody, message: string) => Promise<boolean>;
type SpaceId = (typeof CHANTIER_OPERATIONAL_SPACES)[number]["id"];
type QuoteGroup = ChantierRetainedQuote;

type CoreProps = {
  chantier: ChantierRecord;
  busy: boolean;
  canModify: boolean;
  mutate: Mutate;
};

type Props = CoreProps & {
  commercialCase: CommercialCase | null;
  quotes: NativeQuotesPayload;
  mutateCommercial: Mutate;
};

const spaceDescriptions: Record<SpaceId, string> = {
  admin: "Devis, factures, PPSPS et documents administratifs déjà liés au chantier.",
  be: "Prise de cote, plans et ouvrages à préparer avant validation technique.",
  workshop: "Éléments à préparer, fabriquer et terminer en atelier.",
  install: "Ouvrages ou zones à poser, avec avancement et note de terrain.",
  meeting: "Réunions de chantier, décisions et actions qui en découlent.",
  mail: "Mails entrants et sortants rattachés au chantier.",
  reception: "Réception, PV et réserves à lever.",
};

function spaceIcon(id: SpaceId) {
  if (id === "be") return <ClipboardList size={17} />;
  if (id === "workshop") return <Factory size={17} />;
  if (id === "install") return <Wrench size={17} />;
  if (id === "meeting") return <Users size={17} />;
  if (id === "mail") return <Mail size={17} />;
  if (id === "reception") return <CheckCircle2 size={17} />;
  return <FolderOpen size={17} />;
}

function countForSpace(chantier: ChantierRecord, id: SpaceId): number | null {
  if (id === "be") return chantier.operational.beItems.length;
  if (id === "workshop") return chantier.operational.workshopItems.length;
  if (id === "install") return chantier.operational.installItems.length;
  return null;
}

function originLabel(originKind: TechnicalOrigin, originLabelValue: string | null): string {
  if (originKind === "TS") return originLabelValue ? `TS · ${originLabelValue}` : "TS";
  return originLabelValue ? `Devis · ${originLabelValue}` : "Ligne de devis à préciser";
}

export function ChantierOperationalWorkspace({
  chantier,
  commercialCase,
  quotes,
  busy,
  canModify,
  mutate,
  mutateCommercial,
}: Props) {
  const [space, setSpace] = useState<SpaceId>("admin");
  const quoteGroups = useMemo<QuoteGroup[]>(
    () => (commercialCase ? retainedChantierQuotes(commercialCase, quotes) : []),
    [commercialCase, quotes],
  );
  const quoteLines = useMemo(
    () => (commercialCase ? retainedChantierQuoteLines(commercialCase, quotes) : []),
    [commercialCase, quotes],
  );
  const spaceState = chantier.operational.spaces[space];
  const spaceLabel = CHANTIER_OPERATIONAL_SPACES.find((item) => item.id === space)?.label ?? space;

  return (
    <section className="chantierOperationalWorkspace">
      <nav className="chantierOperationalTabs" aria-label="Rubriques du suivi chantier">
        {CHANTIER_OPERATIONAL_SPACES.map((item) => {
          const count = countForSpace(chantier, item.id);
          const state = chantier.operational.spaces[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className={space === item.id ? "isActive" : undefined}
              onClick={() => setSpace(item.id)}
            >
              {spaceIcon(item.id)}
              <span>{item.label}</span>
              {state === "NOT_APPLICABLE" ? (
                <small>N/C</small>
              ) : count !== null ? (
                <small>{count}</small>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="chantierOperationalTabBody">
        <div className="chantierOpSpaceTitle">
          <div>
            {spaceIcon(space)}
            <span>
              <strong>{spaceLabel}</strong>
              <small>{spaceDescriptions[space]}</small>
            </span>
          </div>
          {canModify ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void mutate(
                  {
                    action: "setOperationalSpaceState",
                    chantierId: chantier.id,
                    spaceId: space,
                    state: spaceState === "NOT_APPLICABLE" ? "APPLICABLE" : "NOT_APPLICABLE",
                  },
                  spaceState === "NOT_APPLICABLE"
                    ? `${spaceLabel} réactivé.`
                    : `${spaceLabel} déclaré Non concerné.`,
                )
              }
            >
              {spaceState === "NOT_APPLICABLE" ? "Réactiver cet espace" : "Marquer Non concerné"}
            </button>
          ) : null}
        </div>

        {spaceState === "NOT_APPLICABLE" ? (
          <OperationalEmpty label="Cet espace est déclaré Non concerné pour ce chantier." />
        ) : (
          <>
            {space === "admin" ? (
              <AdminSpace
                chantier={chantier}
                commercialCase={commercialCase}
                quotes={quotes}
                quoteGroups={quoteGroups}
                quoteLines={quoteLines}
                busy={busy}
                canModify={canModify}
                mutate={mutate}
                mutateCommercial={mutateCommercial}
              />
            ) : null}
            {space === "be" ? (
              <BeSpace
                chantier={chantier}
                commercialCase={commercialCase}
                quotes={quotes}
                busy={busy}
                canModify={canModify}
                mutate={mutate}
                mutateCommercial={mutateCommercial}
                quoteGroups={quoteGroups}
              />
            ) : null}
            {space === "workshop" ? (
              <WorkshopSpace
                chantier={chantier}
                commercialCase={commercialCase}
                quotes={quotes}
                busy={busy}
                canModify={canModify}
                mutate={mutate}
                mutateCommercial={mutateCommercial}
                quoteGroups={quoteGroups}
              />
            ) : null}
            {space === "install" ? (
              <InstallSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} />
            ) : null}
            {space !== "admin" &&
            space !== "be" &&
            space !== "workshop" &&
            space !== "install" ? (
              <FutureSpace id={space} />
            ) : null}
          </>
        )}
      </div>
      <OperationalStyles />
    </section>
  );
}

function AdminSpace({
  chantier,
  commercialCase,
  quotes,
  quoteGroups,
  quoteLines,
  busy,
  canModify,
  mutate,
  mutateCommercial,
}: CoreProps & {
  commercialCase: CommercialCase | null;
  quotes: NativeQuotesPayload;
  quoteGroups: QuoteGroup[];
  quoteLines: ChantierQuoteLineReference[];
  mutateCommercial: Mutate;
}) {
  const [tsName, setTsName] = useState("");
  const retainedIds = new Set(commercialCase?.retainedQuoteIds ?? []);
  const complementaryQuotes = commercialCase
    ? quotes.quotes.filter(
        (quote) =>
          quote.commercialCaseId === commercialCase.id &&
          !retainedIds.has(quote.id) &&
          quoteCanBeRetained(quote),
      )
    : [];

  return (
    <div className="chantierOpSpace">
      <div className="chantierAdminBlock">
        <div className="chantierAdminBlockTitle">
          <div>
            <strong>Devis acceptés</strong>
            <span>
              {quoteGroups.length} devis lié{quoteGroups.length > 1 ? "s" : ""} au chantier, sans
              copie physique.
            </span>
          </div>
        </div>
        {quoteGroups.length === 0 ? (
          <OperationalEmpty label="Aucun devis natif retenu pour ce chantier." />
        ) : (
          <div className="chantierAdminQuotes">
            {quoteGroups.map(({ quote, lines }) => (
              <article key={quote.id}>
                <div>
                  <strong>{quote.finalPdf?.quoteNumber ?? quote.model.subject}</strong>
                  <span>
                    {quote.model.subject} · {quote.variantName} · V{quote.version}
                  </span>
                  <small>
                    {lines.length} ligne{lines.length > 1 ? "s" : ""} de référence
                  </small>
                </div>
                <a href={`/devis/${quote.id}`}>Ouvrir le devis</a>
              </article>
            ))}
          </div>
        )}

        {commercialCase && complementaryQuotes.length > 0 && canModify ? (
          <div className="chantierComplementaryQuotes">
            <div>
              <strong>Devis complémentaires disponibles</strong>
              <span>
                Un devis figé peut être accepté ici. Ses lignes rejoindront immédiatement le
                chantier.
              </span>
            </div>
            {complementaryQuotes.map((quote) => (
              <article key={quote.id}>
                <span>
                  <strong>{quote.finalPdf?.quoteNumber ?? quote.model.subject}</strong>
                  <small>
                    {quote.model.subject} · {quote.variantName} · V{quote.version}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutateCommercial(
                      {
                        action: "retainAdditionalQuote",
                        caseId: commercialCase.id,
                        quoteId: quote.id,
                      },
                      "Devis complémentaire ajouté au chantier.",
                    )
                  }
                >
                  Accepter comme complément
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="chantierAdminBlock">
        <div className="chantierAdminBlockTitle">
          <div>
            <strong>TS non chiffrés / régularisés</strong>
            <span>
              Un TS existe sans montant de vente tant qu’aucun devis complémentaire accepté ne le
              régularise.
            </span>
          </div>
        </div>

        {canModify ? (
          <div className="chantierTsCreate">
            <input
              value={tsName}
              onChange={(event) => setTsName(event.target.value)}
              placeholder="Désignation du TS, ex. ajout tablette demandé en réunion"
            />
            <button
              type="button"
              disabled={busy || !tsName.trim()}
              onClick={async () => {
                const ok = await mutate(
                  { action: "createTs", chantierId: chantier.id, name: tsName },
                  "TS créé.",
                );
                if (ok) setTsName("");
              }}
            >
              <Plus size={14} /> Créer le TS
            </button>
          </div>
        ) : null}

        {chantier.operational.tsItems.length === 0 ? (
          <OperationalEmpty label="Aucun TS enregistré sur ce chantier." />
        ) : (
          <div className="chantierTsRows">
            {chantier.operational.tsItems.map((ts) => (
              <TsRow
                key={ts.id}
                chantier={chantier}
                ts={ts}
                quoteLines={quoteLines}
                busy={busy}
                canModify={canModify}
                mutate={mutate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TsRow({
  chantier,
  ts,
  quoteLines,
  busy,
  canModify,
  mutate,
}: CoreProps & { ts: ChantierTs; quoteLines: ChantierQuoteLineReference[] }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const linked = quoteLines.find(
    (line) => line.quoteId === ts.linkedQuoteId && line.quoteLineId === ts.linkedQuoteLineId,
  );
  const normalized = search.trim().toLocaleLowerCase("fr-FR");
  const visible = normalized
    ? quoteLines.filter((line) =>
        `${line.quoteNumber} ${line.description}`.toLocaleLowerCase("fr-FR").includes(normalized),
      )
    : quoteLines;
  const selectedLine = quoteLines.find(
    (line) => `${line.quoteId}:${line.quoteLineId}` === selected,
  );

  return (
    <article className="chantierTsRow">
      <div>
        <strong>{ts.name}</strong>
        <span>{linked ? `Régularisé · ${chantierQuoteLineDisplay(linked)}` : "TS non chiffré"}</span>
      </div>
      {!linked && canModify ? (
        <div className="chantierTsLink">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher dans les lignes des devis acceptés"
          />
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Choisir une ligne de devis…</option>
            {visible.map((line) => (
              <option
                key={`${line.quoteId}:${line.quoteLineId}`}
                value={`${line.quoteId}:${line.quoteLineId}`}
              >
                {line.quoteNumber} · {line.description}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !selectedLine}
            onClick={() =>
              selectedLine
                ? void mutate(
                    {
                      action: "linkTsToQuoteLine",
                      chantierId: chantier.id,
                      tsId: ts.id,
                      quoteId: selectedLine.quoteId,
                      quoteLineId: selectedLine.quoteLineId,
                      quoteLabel: chantierQuoteLineDisplay(selectedLine),
                    },
                    "TS rattaché au devis complémentaire.",
                  )
                : undefined
            }
          >
            Rattacher
          </button>
        </div>
      ) : null}
    </article>
  );
}

type TechnicalSpaceProps = Props & {
  quoteGroups: QuoteGroup[];
};

function BeSpace({
  chantier,
  busy,
  canModify,
  mutate,
  quoteGroups,
}: TechnicalSpaceProps) {
  const [creating, setCreating] = useState(false);
  const items = chantier.operational.beItems;

  return (
    <div className="chantierOpSpace">
      <div className="chantierOpSpaceTitle">
        <div>
          <ClipboardList size={18} />
          <span>
            <strong>BE</strong>
            <small>
              {items.length} élément{items.length > 1 ? "s" : ""}
            </small>
          </span>
        </div>
        {canModify ? (
          <button type="button" onClick={() => setCreating((value) => !value)}>
            <Plus size={14} /> Nouvel élément BE
          </button>
        ) : null}
      </div>
      <p className="chantierOpHint">
        États : À faire → À dessiner → En validation → Validé. Le passage à Validé crée
        l&apos;élément Atelier et, si l&apos;ouvrage est posé par PAPOT, son suivi Pose.
      </p>
      {creating ? (
        <TechnicalCreateForm
          mode="be"
          busy={busy}
          quoteGroups={quoteGroups}
          tsItems={chantier.operational.tsItems}
          onCancel={() => setCreating(false)}
          onCreate={async (value) => {
            const ok = await mutate(
              { action: "createBeItem", chantierId: chantier.id, ...value },
              "Élément BE créé.",
            );
            if (ok) setCreating(false);
          }}
        />
      ) : null}
      {items.length === 0 ? (
        <OperationalEmpty label="Aucun élément BE pour le moment." />
      ) : (
        <div className="chantierOpRows">
          {items.map((item) => (
            <BeRow
              key={item.id}
              chantier={chantier}
              item={item}
              busy={busy}
              canModify={canModify}
              mutate={mutate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BeRow({ chantier, item, busy, canModify, mutate }: CoreProps & { item: BeItem }) {
  return (
    <div className="chantierOpRow">
      <div className="chantierOpRowMain">
        <strong>{item.name}</strong>
        <span>
          {originLabel(item.originKind, item.originLabel)}
          {item.installedByUs ? " · Pose PAPOT" : " · Sans pose PAPOT"}
        </span>
      </div>
      <select
        value={item.status}
        disabled={!canModify || busy}
        onChange={(event) =>
          void mutate(
            {
              action: "setBeStatus",
              chantierId: chantier.id,
              beItemId: item.id,
              status: event.target.value as BeItemStatus,
            },
            event.target.value === "VALIDATED"
              ? "BE validé, Atelier et Pose alimentés."
              : "Statut BE mis à jour.",
          )
        }
      >
        {Object.entries(BE_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <StatusPill value={BE_STATUS_LABELS[item.status]} done={item.status === "VALIDATED"} />
    </div>
  );
}

function WorkshopSpace({
  chantier,
  busy,
  canModify,
  mutate,
  quoteGroups,
}: TechnicalSpaceProps) {
  const [creating, setCreating] = useState(false);
  const items = chantier.operational.workshopItems;

  return (
    <div className="chantierOpSpace">
      <div className="chantierOpSpaceTitle">
        <div>
          <Factory size={18} />
          <span>
            <strong>Atelier</strong>
            <small>
              {items.length} élément{items.length > 1 ? "s" : ""}
            </small>
          </span>
        </div>
        {canModify ? (
          <button type="button" onClick={() => setCreating((value) => !value)}>
            <Plus size={14} /> Élément direct atelier
          </button>
        ) : null}
      </div>
      <p className="chantierOpHint">
        Un élément peut venir du BE validé ou être créé directement ici pour un débit ou un petit
        ouvrage qui ne passe pas par le BE.
      </p>
      {creating ? (
        <TechnicalCreateForm
          mode="workshop"
          busy={busy}
          quoteGroups={quoteGroups}
          tsItems={chantier.operational.tsItems}
          onCancel={() => setCreating(false)}
          onCreate={async (value) => {
            const ok = await mutate(
              { action: "createWorkshopItem", chantierId: chantier.id, ...value },
              "Élément Atelier créé.",
            );
            if (ok) setCreating(false);
          }}
        />
      ) : null}
      {items.length === 0 ? (
        <OperationalEmpty label="Aucun élément Atelier pour le moment." />
      ) : (
        <div className="chantierOpRows">
          {items.map((item) => (
            <WorkshopRow
              key={item.id}
              chantier={chantier}
              item={item}
              busy={busy}
              canModify={canModify}
              mutate={mutate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkshopRow({
  chantier,
  item,
  busy,
  canModify,
  mutate,
}: CoreProps & { item: WorkshopItem }) {
  return (
    <div className="chantierOpRow">
      <div className="chantierOpRowMain">
        <strong>{item.name}</strong>
        <span>
          {item.sourceBeItemId ? "Issu du BE" : "Créé directement Atelier"} ·{" "}
          {originLabel(item.originKind, item.originLabel)}
          {item.installedByUs ? " · Pose PAPOT" : ""}
        </span>
      </div>
      <select
        value={item.status}
        disabled={!canModify || busy}
        onChange={(event) =>
          void mutate(
            {
              action: "setWorkshopStatus",
              chantierId: chantier.id,
              workshopItemId: item.id,
              status: event.target.value as WorkshopItemStatus,
            },
            "Statut Atelier mis à jour.",
          )
        }
      >
        {Object.entries(WORKSHOP_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <StatusPill value={WORKSHOP_STATUS_LABELS[item.status]} done={item.status === "DONE"} />
    </div>
  );
}

function InstallSpace({ chantier, busy, canModify, mutate }: CoreProps) {
  const items = chantier.operational.installItems;
  return (
    <div className="chantierOpSpace">
      <div className="chantierOpSpaceTitle">
        <div>
          <Wrench size={18} />
          <span>
            <strong>Pose</strong>
            <small>
              {items.length} ouvrage{items.length > 1 ? "s" : ""} / zone
              {items.length > 1 ? "s" : ""}
            </small>
          </span>
        </div>
      </div>
      <p className="chantierOpHint">
        La Pose est indépendante de l&apos;avancement Atelier. Chaque ouvrage ou zone suit
        simplement À faire / En cours / Terminé, avec une note facultative.
      </p>
      {items.length === 0 ? (
        <OperationalEmpty label="Aucun ouvrage prévu en Pose pour le moment." />
      ) : (
        <div className="chantierInstallRows">
          {items.map((item) => (
            <InstallRow
              key={item.id}
              chantier={chantier}
              item={item}
              busy={busy}
              canModify={canModify}
              mutate={mutate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InstallRow({
  chantier,
  item,
  busy,
  canModify,
  mutate,
}: CoreProps & { item: InstallItem }) {
  const [status, setStatus] = useState<InstallItemStatus>(item.status);
  const [note, setNote] = useState(item.note ?? "");

  return (
    <div className="chantierInstallRow">
      <div className="chantierOpRowMain">
        <strong>{item.name}</strong>
        <span>
          {originLabel(item.originKind, item.originLabel)}
          {item.sourceBeItemId ? " · Issu du BE" : " · Issu Atelier"}
        </span>
      </div>
      <select
        value={status}
        disabled={!canModify || busy}
        onChange={(event) => setStatus(event.target.value as InstallItemStatus)}
      >
        {Object.entries(INSTALL_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <textarea
        rows={2}
        value={note}
        disabled={!canModify || busy}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note terrain facultative"
      />
      {canModify ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void mutate(
              {
                action: "setInstallStatus",
                chantierId: chantier.id,
                installItemId: item.id,
                status,
                note,
              },
              "Suivi Pose enregistré.",
            )
          }
        >
          <Save size={14} /> Enregistrer
        </button>
      ) : null}
      <StatusPill value={INSTALL_STATUS_LABELS[item.status]} done={item.status === "DONE"} />
    </div>
  );
}

function TechnicalCreateForm({
  mode,
  busy,
  quoteGroups,
  quoteLinesLoading,
  quoteLinesError,
  onCancel,
  onCreate,
}: {
  mode: "be" | "workshop";
  busy: boolean;
  quoteGroups: QuoteGroup[];
  quoteLinesLoading: boolean;
  quoteLinesError: string | null;
  onCancel: () => void;
  onCreate: (value: {
    name: string;
    originKind: TechnicalOrigin;
    originLabel: string;
    installedByUs: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [originKind, setOriginKind] = useState<TechnicalOrigin>("QUOTE_LINE");
  const [originLabelValue, setOriginLabelValue] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [installedByUs, setInstalledByUs] = useState(true);

  const quoteOptions = useMemo(
    () =>
      quoteGroups.flatMap((group) =>
        group.lines.map((line) => ({
          quoteNumber: group.quoteNumber,
          line,
          value: `${group.quoteNumber} · ${line.ref} · ${line.designation}`,
        })),
      ),
    [quoteGroups],
  );
  const normalizedSearch = quoteSearch.trim().toLocaleLowerCase("fr");
  const visibleGroups = useMemo(
    () =>
      quoteGroups
        .map((group) => ({
          ...group,
          lines: normalizedSearch
            ? group.lines.filter((line) =>
                `${line.ref} ${line.designation}`
                  .toLocaleLowerCase("fr")
                  .includes(normalizedSearch),
              )
            : group.lines,
        }))
        .filter((group) => group.lines.length > 0),
    [quoteGroups, normalizedSearch],
  );

  const originReady = originKind === "TS" || Boolean(originLabelValue.trim());

  function selectQuoteLine(value: string) {
    setOriginLabelValue(value);
    if (!value || name.trim()) return;
    const selected = quoteOptions.find((option) => option.value === value);
    if (selected) setName(selected.line.designation);
  }

  return (
    <div className="chantierTechnicalCreate">
      <div className="chantierTechnicalCreateTitle">
        <strong>{mode === "be" ? "Nouvel élément BE" : "Nouvel élément direct Atelier"}</strong>
        <span>
          Chaque élément reste relié à une vraie ligne de devis, ou est identifié comme TS.
        </span>
      </div>

      <label>
        <span>Nom *</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex. Banque accueil, meuble arrière-bar…"
        />
      </label>
      <label>
        <span>Origine *</span>
        <select
          value={originKind}
          onChange={(event) => {
            const next = event.target.value as TechnicalOrigin;
            setOriginKind(next);
            setOriginLabelValue("");
            setQuoteSearch("");
          }}
        >
          <option value="QUOTE_LINE">Ligne de devis</option>
          <option value="TS">Travaux supplémentaires (TS)</option>
        </select>
      </label>

      {originKind === "QUOTE_LINE" ? (
        <div className="chantierQuotePicker isWide">
          <label>
            <span>Rechercher une ligne</span>
            <input
              value={quoteSearch}
              onChange={(event) => setQuoteSearch(event.target.value)}
              placeholder="N° ou texte, ex. 2.3 ou moulures"
              disabled={quoteLinesLoading || quoteGroups.length === 0}
            />
          </label>
          <label>
            <span>Ligne du devis *</span>
            <select
              value={originLabelValue}
              onChange={(event) => selectQuoteLine(event.target.value)}
              disabled={quoteLinesLoading || quoteGroups.length === 0}
            >
              <option value="">
                {quoteLinesLoading
                  ? "Lecture des devis…"
                  : quoteGroups.length === 0
                    ? "Aucune ligne de devis disponible"
                    : "Choisir une ligne…"}
              </option>
              {visibleGroups.map((group) => (
                <optgroup key={group.quoteNumber} label={`Devis ${group.quoteNumber}`}>
                  {group.lines.map((line) => {
                    const value = `${group.quoteNumber} · ${line.ref} · ${line.designation}`;
                    return (
                      <option
                        key={`${group.quoteNumber}-${line.ref}-${line.designation}`}
                        value={value}
                      >
                        {line.ref} · {line.designation}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
          </label>
          {quoteLinesLoading ? <p>Lecture automatique des lignes des devis OBAT…</p> : null}
          {!quoteLinesLoading && quoteGroups.length > 0 ? (
            <p>
              {quoteOptions.length} ligne{quoteOptions.length > 1 ? "s" : ""} trouvée
              {quoteOptions.length > 1 ? "s" : ""} dans {quoteGroups.length} devis.
            </p>
          ) : null}
          {!quoteLinesLoading && quoteGroups.length === 0 ? (
            <p className="isWarning">
              {quoteLinesError ??
                "Aucune ligne lisible trouvée. Importe le PDF du devis OBAT dans l'affaire commerciale."}
            </p>
          ) : null}
        </div>
      ) : (
        <label className="isWide">
          <span>Description TS</span>
          <input
            value={originLabelValue}
            onChange={(event) => setOriginLabelValue(event.target.value)}
            placeholder="Ex. ajout tablette demandé en réunion"
          />
        </label>
      )}

      <label className="chantierTechnicalCheck">
        <input
          type="checkbox"
          checked={installedByUs}
          onChange={(event) => setInstalledByUs(event.target.checked)}
        />
        Ouvrage posé par PAPOT
      </label>

      <div className="chantierTechnicalActions">
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="isPrimary"
          disabled={busy || !name.trim() || !originReady}
          onClick={() =>
            void onCreate({
              name,
              originKind,
              originLabel: originLabelValue,
              installedByUs,
            })
          }
        >
          <Plus size={14} /> Créer
        </button>
      </div>
    </div>
  );
}

function StatusPill({ value, done }: { value: string; done: boolean }) {
  return <span className={`chantierOpStatus${done ? " isDone" : ""}`}>{value}</span>;
}

function OperationalEmpty({ label }: { label: string }) {
  return (
    <div className="chantierOpEmpty">
      <FolderOpen size={24} />
      <strong>{label}</strong>
    </div>
  );
}

function FutureSpace({ id }: { id: Exclude<SpaceId, "be" | "workshop" | "install"> }) {
  const title = CHANTIER_OPERATIONAL_SPACES.find((item) => item.id === id)?.label ?? id;
  return (
    <div className="chantierFutureSpace">
      <span>
        {id === "meeting" ? (
          <Users size={21} />
        ) : id === "mail" ? (
          <Mail size={21} />
        ) : id === "reception" ? (
          <CheckCircle2 size={21} />
        ) : (
          <BriefcaseBusiness size={21} />
        )}
      </span>
      <strong>{title}</strong>
      <p>{spaceDescriptions[id]}</p>
      <small>
        Cette rubrique est déjà réservée dans la fiche chantier. Son contenu métier sera raccordé
        dans une prochaine étape.
      </small>
    </div>
  );
}

function OperationalStyles() {
  return (
    <style jsx global>{`
      .chantierOperationalWorkspace {
        padding: 16px;
        display: grid;
        gap: 14px;
        border: 1px solid #e9e5f0;
        border-radius: 11px;
        background: #fff;
      }
      .chantierOperationalTabs {
        padding: 6px;
        display: flex;
        gap: 5px;
        overflow-x: auto;
        border: 1px solid #e3deed;
        border-radius: 10px;
        background: #faf8ff;
      }
      .chantierOperationalTabs button {
        min-height: 42px;
        padding: 0 13px;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: #706978;
        font-size: 13px;
        font-weight: 750;
      }
      .chantierOperationalTabs button:hover {
        background: white;
        color: #5f51a1;
      }
      .chantierOperationalTabs button.isActive {
        border-color: #a894ec;
        background: white;
        color: #6551c7;
        box-shadow: 0 2px 8px rgb(87 67 150 / 0.08);
      }
      .chantierOperationalTabs small {
        min-width: 22px;
        padding: 2px 6px;
        border-radius: 999px;
        background: #eeeaf6;
        color: #766c86;
        font-size: 11px;
        text-align: center;
      }
      .chantierOperationalTabBody {
        min-height: 320px;
      }
      .chantierOpSpace {
        display: grid;
        gap: 12px;
      }
      .chantierOpSpaceTitle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .chantierOpSpaceTitle > div {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #5c50b3;
      }
      .chantierOpSpaceTitle > div > span {
        display: grid;
        gap: 2px;
      }
      .chantierOpSpaceTitle strong {
        font-size: 16px;
        color: #4f4956;
      }
      .chantierOpSpaceTitle small {
        color: #817b88;
        font-size: 13px;
      }
      .chantierOpSpaceTitle > button {
        min-height: 37px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #a998e4;
        border-radius: 7px;
        background: #f7f3ff;
        color: #6351bf;
        font-size: 13px;
        font-weight: 750;
      }
      .chantierOpHint {
        margin: 0;
        color: #746e7a;
        font-size: 13px;
        line-height: 1.5;
      }
      .chantierOpRows,
      .chantierInstallRows {
        display: grid;
        gap: 8px;
      }
      .chantierOpRow {
        padding: 11px 12px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 180px auto;
        gap: 9px;
        align-items: center;
        border: 1px solid #ece8f1;
        border-radius: 8px;
        background: #fdfcff;
      }
      .chantierOpRowMain {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .chantierOpRowMain strong {
        font-size: 14px;
        color: #4e4954;
      }
      .chantierOpRowMain span {
        overflow: hidden;
        color: #746e7a;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chantierOpRow select,
      .chantierInstallRow select,
      .chantierTechnicalCreate select,
      .chantierTechnicalCreate input,
      .chantierInstallRow textarea {
        width: 100%;
        padding: 10px 11px;
        border: 1px solid #ddd8e5;
        border-radius: 7px;
        background: #fff;
        color: #57515e;
        font: inherit;
        font-size: 13px;
      }
      .chantierOpStatus {
        padding: 5px 8px;
        border-radius: 999px;
        background: #f0edf5;
        color: #766e80;
        font-size: 12px;
        font-weight: 750;
        white-space: nowrap;
      }
      .chantierOpStatus.isDone {
        background: #e9f6ed;
        color: #3b7b55;
      }
      .chantierOpEmpty {
        min-height: 150px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 7px;
        border: 1px dashed #ddd7e7;
        border-radius: 9px;
        background: #fcfbfd;
        color: #9d97a1;
      }
      .chantierOpEmpty strong {
        font-size: 13px;
      }
      .chantierTechnicalCreate {
        padding: 14px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 11px;
        border: 1px solid #dcd3f1;
        border-radius: 9px;
        background: #faf8ff;
      }
      .chantierTechnicalCreateTitle {
        grid-column: 1/-1;
        display: grid;
        gap: 3px;
      }
      .chantierTechnicalCreateTitle strong {
        font-size: 15px;
      }
      .chantierTechnicalCreateTitle span {
        color: #746e7a;
        font-size: 13px;
      }
      .chantierTechnicalCreate label {
        display: grid;
        gap: 5px;
      }
      .chantierTechnicalCreate label > span {
        font-size: 12px;
        font-weight: 750;
        color: #615a68;
      }
      .chantierTechnicalCreate .isWide {
        grid-column: 1/-1;
      }
      .chantierQuotePicker {
        display: grid;
        grid-template-columns: minmax(180px, 0.6fr) minmax(0, 1.4fr);
        gap: 9px;
      }
      .chantierQuotePicker > p {
        grid-column: 1/-1;
        margin: 0;
        color: #746e7a;
        font-size: 12px;
      }
      .chantierQuotePicker > p.isWarning {
        padding: 8px 10px;
        border: 1px solid #e7d1ad;
        border-radius: 7px;
        background: #fffaf0;
        color: #8d642d;
      }
      .chantierTechnicalCheck {
        grid-column: 1/-1;
        display: flex !important;
        grid-template-columns: auto 1fr !important;
        align-items: center;
        justify-content: flex-start;
        gap: 7px !important;
        color: #615a68;
        font-size: 13px;
      }
      .chantierTechnicalCheck input {
        width: auto !important;
      }
      .chantierTechnicalActions {
        grid-column: 1/-1;
        display: flex;
        justify-content: flex-end;
        gap: 7px;
      }
      .chantierTechnicalActions button,
      .chantierInstallRow > button {
        min-height: 36px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 1px solid #ddd8e5;
        border-radius: 7px;
        background: #fff;
        color: #625b69;
        font-size: 13px;
      }
      .chantierTechnicalActions button.isPrimary,
      .chantierInstallRow > button {
        border-color: #8e7bd9;
        background: #8e7bd9;
        color: white;
        font-weight: 750;
      }
      .chantierInstallRow {
        padding: 11px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 150px minmax(190px, 0.7fr) auto auto;
        gap: 9px;
        align-items: center;
        border: 1px solid #ece8f1;
        border-radius: 8px;
        background: #fdfcff;
      }
      .chantierInstallRow textarea {
        resize: vertical;
      }
      .chantierFutureSpace {
        min-height: 260px;
        display: grid;
        place-items: center;
        align-content: center;
        gap: 8px;
        border: 1px dashed #ded8e7;
        border-radius: 10px;
        background: #fcfbfd;
        text-align: center;
      }
      .chantierFutureSpace > span {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border-radius: 11px;
        background: #eee9ff;
        color: #6855c1;
      }
      .chantierFutureSpace strong {
        font-size: 16px;
      }
      .chantierFutureSpace p {
        max-width: 560px;
        margin: 0;
        color: #746e7a;
        font-size: 13px;
      }
      .chantierFutureSpace small {
        max-width: 600px;
        color: #817b88;
        font-size: 12px;
        line-height: 1.45;
      }
      .chantierOpSpaceTitle button:disabled,
      .chantierTechnicalActions button:disabled,
      .chantierInstallRow > button:disabled {
        opacity: 0.55;
      }
      @media (max-width: 900px) {
        .chantierOpRow {
          grid-template-columns: minmax(0, 1fr) 160px;
        }
        .chantierOpStatus {
          grid-column: 1/-1;
          width: max-content;
        }
        .chantierInstallRow {
          grid-template-columns: 1fr 160px;
        }
        .chantierInstallRow textarea,
        .chantierInstallRow > button,
        .chantierInstallRow > .chantierOpStatus {
          grid-column: 1/-1;
        }
        .chantierInstallRow > button {
          width: max-content;
        }
        .chantierTechnicalCreate {
          grid-template-columns: 1fr;
        }
        .chantierTechnicalCreateTitle,
        .chantierTechnicalCreate .isWide,
        .chantierTechnicalCheck,
        .chantierTechnicalActions {
          grid-column: auto;
        }
        .chantierQuotePicker {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 620px) {
        .chantierOpSpaceTitle {
          flex-direction: column;
          align-items: stretch;
        }
        .chantierOpRow,
        .chantierInstallRow {
          grid-template-columns: 1fr;
        }
        .chantierOpRow select,
        .chantierInstallRow select {
          grid-column: 1/-1;
        }
        .chantierOperationalTabs {
          gap: 3px;
        }
        .chantierOperationalTabs button {
          padding: 0 10px;
        }
      }
    `}</style>
  );
}
