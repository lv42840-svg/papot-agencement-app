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
  type InstallItem,
  type InstallItemStatus,
  type TechnicalOrigin,
  type WorkshopItem,
  type WorkshopItemStatus,
} from "@/lib/chantiers/domain";
import type { CommercialCase } from "@/lib/commercial/domain";
import {
  chantierQuoteLineDisplay,
  retainedChantierQuotes,
  type ChantierRetainedQuote,
} from "@/lib/chantiers/quote-links";
import { quoteCanBeRetained } from "@/lib/quotes/retention";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type MutationBody = Record<string, unknown> & { action: string };
type Mutate = (body: MutationBody, message: string) => Promise<boolean>;
type SpaceId = (typeof CHANTIER_OPERATIONAL_SPACES)[number]["id"];
type QuoteGroup = ChantierRetainedQuote;

const QUOTE_STATUS_LABELS = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
  SUPERSEDED: "Version précédente",
} as const;

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
            {space !== "admin" && space !== "be" && space !== "workshop" && space !== "install" ? (
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
  busy,
  canModify,
  mutateCommercial,
}: CoreProps & {
  commercialCase: CommercialCase | null;
  quotes: NativeQuotesPayload;
  quoteGroups: QuoteGroup[];
  mutateCommercial: Mutate;
}) {
  const retainedIds = new Set(commercialCase?.retainedQuoteIds ?? []);
  const otherQuotes = commercialCase
    ? quotes.quotes
        .filter(
          (quote) => quote.commercialCaseId === commercialCase.id && !retainedIds.has(quote.id),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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
          {commercialCase && canModify ? (
            <a
              className="chantierNewQuoteLink"
              href={`/devis/nouveau?affaire=${encodeURIComponent(commercialCase.id)}&chantier=1`}
            >
              <Plus size={14} /> Nouveau devis / TS
            </a>
          ) : null}
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
                    {quote.quoteKind === "TS"
                      ? "TS"
                      : chantier.initialRetainedQuoteIds.includes(quote.id)
                        ? "Contrat initial"
                        : "Complément"}{" "}
                    · {lines.length} ligne{lines.length > 1 ? "s" : ""} de référence
                  </small>
                </div>
                <div className="chantierAdminQuoteActions">
                  {commercialCase && quote.finalPdf ? (
                    <a
                      href={`/api/desktop/commercial/${commercialCase.id}/documents/${quote.finalPdf.commercialDocumentId}`}
                    >
                      Voir le PDF
                    </a>
                  ) : null}
                  <a href={`/devis/${quote.id}`}>Ouvrir le devis</a>
                </div>
              </article>
            ))}
          </div>
        )}

        {commercialCase && otherQuotes.length > 0 ? (
          <div className="chantierComplementaryQuotes">
            <div>
              <strong>Autres devis / historique</strong>
              <span>
                Brouillons, compléments, TS refusés et anciennes versions restent consultables.
                Seuls les devis figés éligibles peuvent rejoindre le contrat.
              </span>
            </div>
            {otherQuotes.map((quote) => (
              <article key={quote.id}>
                <span>
                  <strong>{quote.finalPdf?.quoteNumber ?? quote.model.subject}</strong>
                  <small>
                    {quote.quoteKind === "TS" ? "TS" : "Devis"} · {quote.model.subject} ·{" "}
                    {quote.variantName} · V{quote.version} · {QUOTE_STATUS_LABELS[quote.status]}
                  </small>
                </span>
                <div className="chantierAdminQuoteActions">
                  {quote.finalPdf ? (
                    <a
                      href={`/api/desktop/commercial/${commercialCase.id}/documents/${quote.finalPdf.commercialDocumentId}`}
                    >
                      Voir le PDF
                    </a>
                  ) : null}
                  <a href={`/devis/${quote.id}`}>Ouvrir le devis</a>
                  {canModify && quoteCanBeRetained(quote) ? (
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
                          quote.quoteKind === "TS"
                            ? "TS accepté et ajouté au chantier."
                            : "Devis complémentaire ajouté au chantier.",
                        )
                      }
                    >
                      {quote.quoteKind === "TS" ? "Accepter le TS" : "Accepter comme complément"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type TechnicalSpaceProps = Props & {
  quoteGroups: QuoteGroup[];
};

function BeSpace({ chantier, busy, canModify, mutate, quoteGroups }: TechnicalSpaceProps) {
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

function WorkshopSpace({ chantier, busy, canModify, mutate, quoteGroups }: TechnicalSpaceProps) {
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
  onCancel,
  onCreate,
}: {
  mode: "be" | "workshop";
  busy: boolean;
  quoteGroups: QuoteGroup[];
  onCancel: () => void;
  onCreate: (value: {
    name: string;
    originKind: TechnicalOrigin;
    originLabel: string;
    installedByUs: boolean;
    sourceQuoteId: string;
    sourceQuoteLineId: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [selectedQuoteLine, setSelectedQuoteLine] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [installedByUs, setInstalledByUs] = useState(true);

  const quoteOptions = useMemo(
    () =>
      quoteGroups.flatMap((group) =>
        group.lines.map((line) => ({
          line,
          value: `${line.quoteId}:${line.quoteLineId}`,
        })),
      ),
    [quoteGroups],
  );
  const normalizedSearch = quoteSearch.trim().toLocaleLowerCase("fr-FR");
  const visibleGroups = useMemo(
    () =>
      quoteGroups
        .map((group) => ({
          ...group,
          lines: normalizedSearch
            ? group.lines.filter((line) =>
                `${line.quoteNumber} ${line.description}`
                  .toLocaleLowerCase("fr-FR")
                  .includes(normalizedSearch),
              )
            : group.lines,
        }))
        .filter((group) => group.lines.length > 0),
    [quoteGroups, normalizedSearch],
  );
  const selectedQuote = quoteOptions.find((option) => option.value === selectedQuoteLine)?.line;

  function selectQuoteLine(value: string) {
    setSelectedQuoteLine(value);
    const selected = quoteOptions.find((option) => option.value === value)?.line;
    if (selected && !name.trim()) setName(selected.description);
  }

  return (
    <div className="chantierTechnicalCreate">
      <div className="chantierTechnicalCreateTitle">
        <strong>{mode === "be" ? "Nouvel élément BE" : "Nouvel élément direct Atelier"}</strong>
        <span>
          Chaque élément pointe vers une vraie ligne d’un devis accepté. Un TS accepté reste un
          devis PAPOT normal, identifié comme TS.
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

      <div className="chantierQuotePicker isWide">
        <label>
          <span>Rechercher une ligne</span>
          <input
            value={quoteSearch}
            onChange={(event) => setQuoteSearch(event.target.value)}
            placeholder="N° de devis ou texte, ex. banque accueil"
            disabled={quoteGroups.length === 0}
          />
        </label>
        <label>
          <span>Ligne du devis accepté *</span>
          <select
            value={selectedQuoteLine}
            onChange={(event) => selectQuoteLine(event.target.value)}
            disabled={quoteGroups.length === 0}
          >
            <option value="">
              {quoteGroups.length === 0
                ? "Aucun devis accepté avec ligne disponible"
                : "Choisir une ligne…"}
            </option>
            {visibleGroups.map((group) => (
              <optgroup
                key={group.quote.id}
                label={`${group.quote.quoteKind === "TS" ? "TS · " : ""}${group.quote.finalPdf?.quoteNumber ?? group.quote.model.subject} · ${group.quote.variantName} · V${group.quote.version}`}
              >
                {group.lines.map((line) => (
                  <option
                    key={`${line.quoteId}:${line.quoteLineId}`}
                    value={`${line.quoteId}:${line.quoteLineId}`}
                  >
                    {line.description}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {quoteGroups.length > 0 ? (
          <p>
            {quoteOptions.length} ligne{quoteOptions.length > 1 ? "s" : ""} issue
            {quoteOptions.length > 1 ? "s" : ""} des seuls devis / TS acceptés.
          </p>
        ) : (
          <p className="isWarning">
            Aucun devis natif accepté n’est disponible. Crée puis fais accepter le devis / TS depuis
            l’espace Admin.
          </p>
        )}
      </div>

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
          disabled={busy || !name.trim() || !selectedQuote}
          onClick={() =>
            selectedQuote
              ? void onCreate({
                  name,
                  originKind: selectedQuote.quoteKind === "TS" ? "TS" : "QUOTE_LINE",
                  originLabel: chantierQuoteLineDisplay(selectedQuote),
                  installedByUs,
                  sourceQuoteId: selectedQuote.quoteId,
                  sourceQuoteLineId: selectedQuote.quoteLineId,
                })
              : undefined
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
      .chantierAdminBlock {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid #e6e0ee;
        border-radius: 9px;
        background: #fcfbfe;
      }
      .chantierAdminBlockTitle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .chantierAdminBlockTitle > div,
      .chantierComplementaryQuotes > div {
        display: grid;
        gap: 3px;
      }
      .chantierAdminBlockTitle strong,
      .chantierComplementaryQuotes > div > strong {
        font-size: 14px;
        color: #4f4956;
      }
      .chantierAdminBlockTitle span,
      .chantierComplementaryQuotes > div > span {
        color: #7c7582;
        font-size: 12px;
      }
      .chantierAdminQuotes,
      .chantierComplementaryQuotes,
      .chantierTsRows {
        display: grid;
        gap: 7px;
      }
      .chantierAdminQuotes article,
      .chantierComplementaryQuotes article,
      .chantierTsRow {
        padding: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border: 1px solid #e8e3ed;
        border-radius: 8px;
        background: white;
      }
      .chantierAdminQuotes article > div,
      .chantierComplementaryQuotes article > span,
      .chantierTsRow > div:first-child {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .chantierAdminQuotes span,
      .chantierAdminQuotes small,
      .chantierComplementaryQuotes small,
      .chantierTsRow span {
        color: #7f7885;
        font-size: 11px;
      }
      .chantierAdminQuotes a,
      .chantierNewQuoteLink,
      .chantierComplementaryQuotes button,
      .chantierTsCreate button,
      .chantierTsLink button {
        min-height: 34px;
        padding: 0 9px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 1px solid #a998e4;
        border-radius: 7px;
        background: #f7f3ff;
        color: #6351bf;
        font-size: 12px;
        font-weight: 750;
        text-decoration: none;
        white-space: nowrap;
      }
      .chantierAdminQuoteActions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .chantierComplementaryQuotes {
        padding-top: 4px;
        border-top: 1px solid #eeeaf2;
      }
      .chantierTsCreate {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
      }
      .chantierTsCreate input,
      .chantierTsLink input,
      .chantierTsLink select {
        width: 100%;
        min-height: 35px;
        padding: 7px 9px;
        border: 1px solid #ddd8e5;
        border-radius: 7px;
        background: white;
        color: #57515e;
        font: inherit;
        font-size: 12px;
      }
      .chantierTsLink {
        min-width: min(520px, 60vw);
        display: grid !important;
        grid-template-columns: minmax(120px, 0.7fr) minmax(180px, 1.3fr) auto;
        gap: 6px !important;
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
        .chantierAdminBlockTitle,
        .chantierAdminQuotes article,
        .chantierComplementaryQuotes article,
        .chantierTsRow {
          align-items: stretch;
          flex-direction: column;
        }
        .chantierAdminQuoteActions {
          justify-content: flex-start;
        }
        .chantierTsLink {
          min-width: 0;
          grid-template-columns: 1fr;
        }
        .chantierTsCreate {
          grid-template-columns: 1fr;
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
