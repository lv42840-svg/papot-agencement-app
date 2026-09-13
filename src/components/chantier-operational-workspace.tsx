"use client";

import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Factory,
  FolderOpen,
  Mail,
  MapPin,
  Plus,
  Save,
  Users,
  Wrench,
} from "lucide-react";
import { useState } from "react";
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

type MutationBody = Record<string, unknown> & { action: string };
type Mutate = (body: MutationBody, message: string) => Promise<boolean>;
type SpaceId = "overview" | (typeof CHANTIER_OPERATIONAL_SPACES)[number]["id"];

type Props = {
  chantier: ChantierRecord;
  busy: boolean;
  canModify: boolean;
  mutate: Mutate;
};

const spaceDescriptions: Record<Exclude<SpaceId, "overview">, string> = {
  admin: "Devis, factures, PPSPS et documents administratifs déjà liés au chantier.",
  be: "Prise de cote, plans et ouvrages à préparer avant validation technique.",
  workshop: "Éléments à préparer, fabriquer et terminer en atelier.",
  install: "Ouvrages ou zones à poser, avec avancement et note de terrain.",
  meeting: "Réunions de chantier, décisions et actions qui en découlent.",
  mail: "Mails entrants et sortants rattachés au chantier.",
  reception: "Réception, PV et réserves à lever.",
};

function spaceIcon(id: Exclude<SpaceId, "overview">) {
  if (id === "be") return <ClipboardList size={16} />;
  if (id === "workshop") return <Factory size={16} />;
  if (id === "install") return <Wrench size={16} />;
  if (id === "meeting") return <Users size={16} />;
  if (id === "mail") return <Mail size={16} />;
  if (id === "reception") return <CheckCircle2 size={16} />;
  return <FolderOpen size={16} />;
}

function countForSpace(chantier: ChantierRecord, id: Exclude<SpaceId, "overview">): number | null {
  if (id === "be") return chantier.operational.beItems.length;
  if (id === "workshop") return chantier.operational.workshopItems.length;
  if (id === "install") return chantier.operational.installItems.length;
  return null;
}

function originLabel(originKind: TechnicalOrigin, originLabelValue: string | null): string {
  if (originKind === "TS") return originLabelValue ? `TS · ${originLabelValue}` : "TS";
  return originLabelValue ? `Devis · ${originLabelValue}` : "Ligne de devis à préciser";
}

export function ChantierOperationalWorkspace({ chantier, busy, canModify, mutate }: Props) {
  const [space, setSpace] = useState<SpaceId>("overview");

  return (
    <section className="chantierOperationalWorkspace">
      <div className="chantierOperationalHeader">
        <div>
          <strong>Suivi opérationnel</strong>
          <span>Les phases peuvent avancer en parallèle. Valider un élément BE alimente automatiquement l&apos;Atelier et, s&apos;il est posé par PAPOT, la Pose.</span>
        </div>
        {space !== "overview" ? (
          <button type="button" onClick={() => setSpace("overview")}><ArrowLeft size={13} /> Vue d&apos;ensemble</button>
        ) : null}
      </div>

      {space === "overview" ? (
        <div className="chantierOperationalCards">
          {CHANTIER_OPERATIONAL_SPACES.map((item) => {
            const count = countForSpace(chantier, item.id);
            return (
              <button key={item.id} type="button" onClick={() => setSpace(item.id)}>
                <span className="chantierOperationalIcon">{spaceIcon(item.id)}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{spaceDescriptions[item.id]}</small>
                </div>
                {count !== null ? <em>{count}</em> : <em className="isFuture">À raccorder</em>}
              </button>
            );
          })}
        </div>
      ) : null}

      {space === "be" ? <BeSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} /> : null}
      {space === "workshop" ? <WorkshopSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} /> : null}
      {space === "install" ? <InstallSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} /> : null}
      {space !== "overview" && space !== "be" && space !== "workshop" && space !== "install" ? (
        <FutureSpace id={space} />
      ) : null}

      <OperationalStyles />
    </section>
  );
}

function BeSpace({ chantier, busy, canModify, mutate }: Props) {
  const [creating, setCreating] = useState(false);
  const items = chantier.operational.beItems;
  return (
    <div className="chantierOpSpace">
      <div className="chantierOpSpaceTitle">
        <div><ClipboardList size={17} /><span><strong>BE</strong><small>{items.length} élément{items.length > 1 ? "s" : ""}</small></span></div>
        {canModify ? <button type="button" onClick={() => setCreating((value) => !value)}><Plus size={13} /> Nouvel élément BE</button> : null}
      </div>
      <p className="chantierOpHint">États : À faire → À dessiner → En validation → Validé. Le passage à Validé crée l&apos;élément Atelier et, si l&apos;ouvrage est posé par PAPOT, son suivi Pose.</p>
      {creating ? (
        <TechnicalCreateForm
          mode="be"
          busy={busy}
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
      {items.length === 0 ? <OperationalEmpty label="Aucun élément BE pour le moment." /> : (
        <div className="chantierOpRows">
          {items.map((item) => <BeRow key={item.id} chantier={chantier} item={item} busy={busy} canModify={canModify} mutate={mutate} />)}
        </div>
      )}
    </div>
  );
}

function BeRow({ chantier, item, busy, canModify, mutate }: Props & { item: BeItem }) {
  return (
    <div className="chantierOpRow">
      <div className="chantierOpRowMain">
        <strong>{item.name}</strong>
        <span>{originLabel(item.originKind, item.originLabel)}{item.installedByUs ? " · Pose PAPOT" : " · Sans pose PAPOT"}</span>
      </div>
      <select
        value={item.status}
        disabled={!canModify || busy}
        onChange={(event) => void mutate(
          { action: "setBeStatus", chantierId: chantier.id, beItemId: item.id, status: event.target.value as BeItemStatus },
          event.target.value === "VALIDATED" ? "BE validé, Atelier et Pose alimentés." : "Statut BE mis à jour.",
        )}
      >
        {Object.entries(BE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <StatusPill value={BE_STATUS_LABELS[item.status]} done={item.status === "VALIDATED"} />
    </div>
  );
}

function WorkshopSpace({ chantier, busy, canModify, mutate }: Props) {
  const [creating, setCreating] = useState(false);
  const items = chantier.operational.workshopItems;
  return (
    <div className="chantierOpSpace">
      <div className="chantierOpSpaceTitle">
        <div><Factory size={17} /><span><strong>Atelier</strong><small>{items.length} élément{items.length > 1 ? "s" : ""}</small></span></div>
        {canModify ? <button type="button" onClick={() => setCreating((value) => !value)}><Plus size={13} /> Élément direct atelier</button> : null}
      </div>
      <p className="chantierOpHint">Un élément peut venir du BE validé ou être créé directement ici pour un débit / petit ouvrage qui ne passe pas par le BE.</p>
      {creating ? (
        <TechnicalCreateForm
          mode="workshop"
          busy={busy}
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
      {items.length === 0 ? <OperationalEmpty label="Aucun élément Atelier pour le moment." /> : (
        <div className="chantierOpRows">
          {items.map((item) => <WorkshopRow key={item.id} chantier={chantier} item={item} busy={busy} canModify={canModify} mutate={mutate} />)}
        </div>
      )}
    </div>
  );
}

function WorkshopRow({ chantier, item, busy, canModify, mutate }: Props & { item: WorkshopItem }) {
  return (
    <div className="chantierOpRow">
      <div className="chantierOpRowMain">
        <strong>{item.name}</strong>
        <span>{item.sourceBeItemId ? "Issu du BE" : "Créé directement Atelier"} · {originLabel(item.originKind, item.originLabel)}{item.installedByUs ? " · Pose PAPOT" : ""}</span>
      </div>
      <select
        value={item.status}
        disabled={!canModify || busy}
        onChange={(event) => void mutate(
          { action: "setWorkshopStatus", chantierId: chantier.id, workshopItemId: item.id, status: event.target.value as WorkshopItemStatus },
          "Statut Atelier mis à jour.",
        )}
      >
        {Object.entries(WORKSHOP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <StatusPill value={WORKSHOP_STATUS_LABELS[item.status]} done={item.status === "DONE"} />
    </div>
  );
}

function InstallSpace({ chantier, busy, canModify, mutate }: Props) {
  const items = chantier.operational.installItems;
  return (
    <div className="chantierOpSpace">
      <div className="chantierOpSpaceTitle">
        <div><Wrench size={17} /><span><strong>Pose</strong><small>{items.length} ouvrage{items.length > 1 ? "s" : ""} / zone{items.length > 1 ? "s" : ""}</small></span></div>
      </div>
      <p className="chantierOpHint">La Pose est indépendante de l&apos;avancement Atelier. Chaque ouvrage ou zone suit simplement À faire / En cours / Terminé, avec une note facultative.</p>
      {items.length === 0 ? <OperationalEmpty label="Aucun ouvrage prévu en Pose pour le moment." /> : (
        <div className="chantierInstallRows">
          {items.map((item) => <InstallRow key={item.id} chantier={chantier} item={item} busy={busy} canModify={canModify} mutate={mutate} />)}
        </div>
      )}
    </div>
  );
}

function InstallRow({ chantier, item, busy, canModify, mutate }: Props & { item: InstallItem }) {
  const [status, setStatus] = useState<InstallItemStatus>(item.status);
  const [note, setNote] = useState(item.note ?? "");
  return (
    <div className="chantierInstallRow">
      <div className="chantierOpRowMain">
        <strong>{item.name}</strong>
        <span>{originLabel(item.originKind, item.originLabel)}{item.sourceBeItemId ? " · Issu du BE" : " · Issu Atelier"}</span>
      </div>
      <select value={status} disabled={!canModify || busy} onChange={(event) => setStatus(event.target.value as InstallItemStatus)}>
        {Object.entries(INSTALL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <textarea rows={2} value={note} disabled={!canModify || busy} onChange={(event) => setNote(event.target.value)} placeholder="Note terrain facultative" />
      {canModify ? (
        <button type="button" disabled={busy} onClick={() => void mutate(
          { action: "setInstallStatus", chantierId: chantier.id, installItemId: item.id, status, note },
          "Suivi Pose enregistré.",
        )}><Save size={13} /> Enregistrer</button>
      ) : null}
      <StatusPill value={INSTALL_STATUS_LABELS[item.status]} done={item.status === "DONE"} />
    </div>
  );
}

function TechnicalCreateForm({
  mode,
  busy,
  onCancel,
  onCreate,
}: {
  mode: "be" | "workshop";
  busy: boolean;
  onCancel: () => void;
  onCreate: (value: { name: string; originKind: TechnicalOrigin; originLabel: string; installedByUs: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [originKind, setOriginKind] = useState<TechnicalOrigin>("QUOTE_LINE");
  const [originLabelValue, setOriginLabelValue] = useState("");
  const [installedByUs, setInstalledByUs] = useState(true);
  const originReady = originKind === "TS" || Boolean(originLabelValue.trim());

  return (
    <div className="chantierTechnicalCreate">
      <div className="chantierTechnicalCreateTitle">
        <strong>{mode === "be" ? "Nouvel élément BE" : "Nouvel élément direct Atelier"}</strong>
        <span>Chaque élément doit rester relié à une ligne du devis ou être identifié comme TS.</span>
      </div>
      <label><span>Nom *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Banque accueil, meuble arrière-bar…" /></label>
      <label><span>Origine *</span><select value={originKind} onChange={(event) => setOriginKind(event.target.value as TechnicalOrigin)}><option value="QUOTE_LINE">Ligne de devis</option><option value="TS">Travaux supplémentaires (TS)</option></select></label>
      <label className="isWide"><span>{originKind === "QUOTE_LINE" ? "Repère / ligne du devis *" : "Description TS (facultative si le nom suffit)"}</span><input value={originLabelValue} onChange={(event) => setOriginLabelValue(event.target.value)} placeholder={originKind === "QUOTE_LINE" ? "Ex. 1.2 Façade de magasin" : "Ex. ajout tablette demandé en réunion"} /></label>
      <label className="chantierTechnicalCheck"><input type="checkbox" checked={installedByUs} onChange={(event) => setInstalledByUs(event.target.checked)} /> Ouvrage posé par PAPOT</label>
      {originKind === "QUOTE_LINE" ? <p>Le repère est saisi manuellement pour l&apos;instant. Le sélecteur des lignes extraites du bordereau OBAT sera raccordé ensuite.</p> : null}
      <div className="chantierTechnicalActions">
        <button type="button" onClick={onCancel}>Annuler</button>
        <button type="button" className="isPrimary" disabled={busy || !name.trim() || !originReady} onClick={() => void onCreate({ name, originKind, originLabel: originLabelValue, installedByUs })}><Plus size={13} /> Créer</button>
      </div>
    </div>
  );
}

function StatusPill({ value, done }: { value: string; done: boolean }) {
  return <span className={`chantierOpStatus${done ? " isDone" : ""}`}>{value}</span>;
}

function OperationalEmpty({ label }: { label: string }) {
  return <div className="chantierOpEmpty"><FolderOpen size={24} /><strong>{label}</strong></div>;
}

function FutureSpace({ id }: { id: Exclude<SpaceId, "overview" | "be" | "workshop" | "install"> }) {
  const title = CHANTIER_OPERATIONAL_SPACES.find((item) => item.id === id)?.label ?? id;
  return (
    <div className="chantierFutureSpace">
      <span>{id === "meeting" ? <Users size={20} /> : id === "mail" ? <Mail size={20} /> : id === "reception" ? <CheckCircle2 size={20} /> : <BriefcaseBusiness size={20} />}</span>
      <strong>{title}</strong>
      <p>{spaceDescriptions[id]}</p>
      <small>La structure est réservée dans la fiche chantier. Cette brique sera raccordée après BE / Atelier / Pose.</small>
    </div>
  );
}

function OperationalStyles() {
  return (
    <style jsx global>{`
      .chantierOperationalWorkspace{padding:14px;display:grid;gap:12px;border:1px solid #e9e5f0;border-radius:11px;background:#fff}.chantierOperationalHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.chantierOperationalHeader>div{display:grid;gap:3px}.chantierOperationalHeader strong{font-size:12px;color:#514c59}.chantierOperationalHeader span{max-width:780px;color:#8d8794;font-size:9px}.chantierOperationalHeader>button{min-height:31px;padding:0 9px;display:inline-flex;align-items:center;gap:5px;border:1px solid #ddd8e8;border-radius:7px;background:#fff;color:#625b6a;font-size:8.5px}.chantierOperationalCards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.chantierOperationalCards>button{padding:11px;display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:start;border:1px solid #ece8f2;border-radius:9px;background:#fdfcff;text-align:left}.chantierOperationalCards>button:hover{border-color:#b9abe5;background:#faf8ff}.chantierOperationalIcon{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:#eee9ff;color:#6956c4}.chantierOperationalCards>button>div{display:grid;gap:3px}.chantierOperationalCards strong{font-size:10px;color:#4f4a56}.chantierOperationalCards small{color:#928b99;font-size:7.8px;line-height:1.35}.chantierOperationalCards em{min-width:24px;padding:3px 6px;border-radius:999px;background:#eee9ff;color:#6654bd;font-size:8px;font-style:normal;font-weight:800;text-align:center}.chantierOperationalCards em.isFuture{background:#f1eff2;color:#8c8490;font-weight:650}.chantierOpSpace{display:grid;gap:10px}.chantierOpSpaceTitle{display:flex;align-items:center;justify-content:space-between;gap:10px}.chantierOpSpaceTitle>div{display:flex;align-items:center;gap:7px;color:#5c50b3}.chantierOpSpaceTitle>div>span{display:grid;gap:1px}.chantierOpSpaceTitle strong{font-size:12px;color:#4f4956}.chantierOpSpaceTitle small{color:#918b97;font-size:8px}.chantierOpSpaceTitle>button{min-height:31px;padding:0 9px;display:inline-flex;align-items:center;gap:5px;border:1px solid #a998e4;border-radius:7px;background:#f7f3ff;color:#6351bf;font-size:8.5px;font-weight:750}.chantierOpHint{margin:0;color:#8c8592;font-size:8.5px}.chantierOpRows,.chantierInstallRows{display:grid;gap:7px}.chantierOpRow{padding:9px 10px;display:grid;grid-template-columns:minmax(0,1fr) 170px auto;gap:8px;align-items:center;border:1px solid #ece8f1;border-radius:8px;background:#fdfcff}.chantierOpRowMain{min-width:0;display:grid;gap:2px}.chantierOpRowMain strong{font-size:9.5px;color:#4e4954}.chantierOpRowMain span{overflow:hidden;color:#918a97;font-size:7.8px;text-overflow:ellipsis;white-space:nowrap}.chantierOpRow select,.chantierInstallRow select,.chantierTechnicalCreate select,.chantierTechnicalCreate input,.chantierInstallRow textarea{width:100%;padding:8px 9px;border:1px solid #ddd8e5;border-radius:7px;background:#fff;color:#57515e;font:inherit;font-size:8.5px}.chantierOpStatus{padding:4px 7px;border-radius:999px;background:#f0edf5;color:#766e80;font-size:7.5px;font-weight:750;white-space:nowrap}.chantierOpStatus.isDone{background:#e9f6ed;color:#3b7b55}.chantierOpEmpty{min-height:150px;display:grid;place-items:center;align-content:center;gap:6px;border:1px dashed #ddd7e7;border-radius:9px;background:#fcfbfd;color:#aaa4ae}.chantierOpEmpty strong{font-size:9px}.chantierTechnicalCreate{padding:11px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;border:1px solid #dcd3f1;border-radius:9px;background:#faf8ff}.chantierTechnicalCreateTitle{grid-column:1/-1;display:grid;gap:2px}.chantierTechnicalCreateTitle strong{font-size:10px}.chantierTechnicalCreateTitle span{color:#8b8392;font-size:8px}.chantierTechnicalCreate label{display:grid;gap:4px}.chantierTechnicalCreate label>span{font-size:8px;font-weight:750;color:#615a68}.chantierTechnicalCreate label.isWide{grid-column:1/-1}.chantierTechnicalCheck{grid-column:1/-1;display:flex!important;grid-template-columns:auto 1fr!important;align-items:center;justify-content:flex-start;gap:6px!important;color:#615a68;font-size:8.5px}.chantierTechnicalCheck input{width:auto!important}.chantierTechnicalCreate>p{grid-column:1/-1;margin:0;color:#9a753c;font-size:7.8px}.chantierTechnicalActions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:6px}.chantierTechnicalActions button,.chantierInstallRow>button{min-height:31px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid #ddd8e5;border-radius:7px;background:#fff;color:#625b69;font-size:8.5px}.chantierTechnicalActions button.isPrimary,.chantierInstallRow>button{border-color:#8e7bd9;background:#8e7bd9;color:white;font-weight:750}.chantierInstallRow{padding:10px;display:grid;grid-template-columns:minmax(0,1fr) 145px minmax(190px,.7fr) auto auto;gap:8px;align-items:center;border:1px solid #ece8f1;border-radius:8px;background:#fdfcff}.chantierInstallRow textarea{resize:vertical}.chantierFutureSpace{min-height:260px;display:grid;place-items:center;align-content:center;gap:7px;border:1px dashed #ded8e7;border-radius:10px;background:#fcfbfd;text-align:center}.chantierFutureSpace>span{width:42px;height:42px;display:grid;place-items:center;border-radius:11px;background:#eee9ff;color:#6855c1}.chantierFutureSpace strong{font-size:12px}.chantierFutureSpace p{max-width:520px;margin:0;color:#807986;font-size:9px}.chantierFutureSpace small{color:#a39da7;font-size:7.8px}.chantierOpSpaceTitle button:disabled,.chantierTechnicalActions button:disabled,.chantierInstallRow>button:disabled{opacity:.55}
      @media(max-width:900px){.chantierOpRow{grid-template-columns:minmax(0,1fr) 150px}.chantierOpStatus{grid-column:1/-1;width:max-content}.chantierInstallRow{grid-template-columns:1fr 150px}.chantierInstallRow textarea,.chantierInstallRow>button,.chantierInstallRow>.chantierOpStatus{grid-column:1/-1}.chantierInstallRow>button{width:max-content}.chantierTechnicalCreate{grid-template-columns:1fr}.chantierTechnicalCreateTitle,.chantierTechnicalCreate label.isWide,.chantierTechnicalCheck,.chantierTechnicalCreate>p,.chantierTechnicalActions{grid-column:auto}}
      @media(max-width:620px){.chantierOperationalHeader,.chantierOpSpaceTitle{flex-direction:column;align-items:stretch}.chantierOpRow,.chantierInstallRow{grid-template-columns:1fr}.chantierOpRow select,.chantierInstallRow select{grid-column:1/-1}.chantierOperationalCards{grid-template-columns:1fr}}
    `}</style>
  );
}
