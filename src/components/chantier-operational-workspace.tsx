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
type SpaceId = (typeof CHANTIER_OPERATIONAL_SPACES)[number]["id"];

type Props = { chantier: ChantierRecord; busy: boolean; canModify: boolean; mutate: Mutate };

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

export function ChantierOperationalWorkspace({ chantier, busy, canModify, mutate }: Props) {
  const [space, setSpace] = useState<SpaceId>("admin");
  return (
    <section className="chantierOperationalWorkspace">
      <div className="chantierOperationalHeader"><div><strong>Suivi opérationnel</strong><span>Choisis directement la rubrique à suivre. BE, Atelier et Pose peuvent avancer en parallèle.</span></div></div>
      <nav className="chantierOperationalTabs" aria-label="Rubriques du suivi chantier">
        {CHANTIER_OPERATIONAL_SPACES.map((item) => {
          const count = countForSpace(chantier, item.id);
          return <button key={item.id} type="button" className={space === item.id ? "isActive" : undefined} onClick={() => setSpace(item.id)}>{spaceIcon(item.id)}<span>{item.label}</span>{count !== null ? <small>{count}</small> : null}</button>;
        })}
      </nav>
      <div className="chantierOperationalTabBody">
        {space === "be" ? <BeSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} /> : null}
        {space === "workshop" ? <WorkshopSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} /> : null}
        {space === "install" ? <InstallSpace chantier={chantier} busy={busy} canModify={canModify} mutate={mutate} /> : null}
        {space !== "be" && space !== "workshop" && space !== "install" ? <FutureSpace id={space} /> : null}
      </div>
      <OperationalStyles />
    </section>
  );
}

function BeSpace({ chantier, busy, canModify, mutate }: Props) {
  const [creating, setCreating] = useState(false);
  const items = chantier.operational.beItems;
  return <div className="chantierOpSpace"><div className="chantierOpSpaceTitle"><div><ClipboardList size={18} /><span><strong>BE</strong><small>{items.length} élément{items.length > 1 ? "s" : ""}</small></span></div>{canModify ? <button type="button" onClick={() => setCreating((value) => !value)}><Plus size={14} /> Nouvel élément BE</button> : null}</div><p className="chantierOpHint">États : À faire → À dessiner → En validation → Validé. Le passage à Validé crée l&apos;élément Atelier et, si l&apos;ouvrage est posé par PAPOT, son suivi Pose.</p>{creating ? <TechnicalCreateForm mode="be" busy={busy} onCancel={() => setCreating(false)} onCreate={async (value) => { const ok = await mutate({ action: "createBeItem", chantierId: chantier.id, ...value }, "Élément BE créé."); if (ok) setCreating(false); }} /> : null}{items.length === 0 ? <OperationalEmpty label="Aucun élément BE pour le moment." /> : <div className="chantierOpRows">{items.map((item) => <BeRow key={item.id} chantier={chantier} item={item} busy={busy} canModify={canModify} mutate={mutate} />)}</div>}</div>;
}

function BeRow({ chantier, item, busy, canModify, mutate }: Props & { item: BeItem }) {
  return <div className="chantierOpRow"><div className="chantierOpRowMain"><strong>{item.name}</strong><span>{originLabel(item.originKind, item.originLabel)}{item.installedByUs ? " · Pose PAPOT" : " · Sans pose PAPOT"}</span></div><select value={item.status} disabled={!canModify || busy} onChange={(event) => void mutate({ action: "setBeStatus", chantierId: chantier.id, beItemId: item.id, status: event.target.value as BeItemStatus }, event.target.value === "VALIDATED" ? "BE validé, Atelier et Pose alimentés." : "Statut BE mis à jour.")}>{Object.entries(BE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><StatusPill value={BE_STATUS_LABELS[item.status]} done={item.status === "VALIDATED"} /></div>;
}

function WorkshopSpace({ chantier, busy, canModify, mutate }: Props) {
  const [creating, setCreating] = useState(false);
  const items = chantier.operational.workshopItems;
  return <div className="chantierOpSpace"><div className="chantierOpSpaceTitle"><div><Factory size={18} /><span><strong>Atelier</strong><small>{items.length} élément{items.length > 1 ? "s" : ""}</small></span></div>{canModify ? <button type="button" onClick={() => setCreating((value) => !value)}><Plus size={14} /> Élément direct atelier</button> : null}</div><p className="chantierOpHint">Un élément peut venir du BE validé ou être créé directement ici pour un débit / petit ouvrage qui ne passe pas par le BE.</p>{creating ? <TechnicalCreateForm mode="workshop" busy={busy} onCancel={() => setCreating(false)} onCreate={async (value) => { const ok = await mutate({ action: "createWorkshopItem", chantierId: chantier.id, ...value }, "Élément Atelier créé."); if (ok) setCreating(false); }} /> : null}{items.length === 0 ? <OperationalEmpty label="Aucun élément Atelier pour le moment." /> : <div className="chantierOpRows">{items.map((item) => <WorkshopRow key={item.id} chantier={chantier} item={item} busy={busy} canModify={canModify} mutate={mutate} />)}</div>}</div>;
}

function WorkshopRow({ chantier, item, busy, canModify, mutate }: Props & { item: WorkshopItem }) {
  return <div className="chantierOpRow"><div className="chantierOpRowMain"><strong>{item.name}</strong><span>{item.sourceBeItemId ? "Issu du BE" : "Créé directement Atelier"} · {originLabel(item.originKind, item.originLabel)}{item.installedByUs ? " · Pose PAPOT" : ""}</span></div><select value={item.status} disabled={!canModify || busy} onChange={(event) => void mutate({ action: "setWorkshopStatus", chantierId: chantier.id, workshopItemId: item.id, status: event.target.value as WorkshopItemStatus }, "Statut Atelier mis à jour.")}>{Object.entries(WORKSHOP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><StatusPill value={WORKSHOP_STATUS_LABELS[item.status]} done={item.status === "DONE"} /></div>;
}

function InstallSpace({ chantier, busy, canModify, mutate }: Props) {
  const items = chantier.operational.installItems;
  return <div className="chantierOpSpace"><div className="chantierOpSpaceTitle"><div><Wrench size={18} /><span><strong>Pose</strong><small>{items.length} ouvrage{items.length > 1 ? "s" : ""} / zone{items.length > 1 ? "s" : ""}</small></span></div></div><p className="chantierOpHint">La Pose est indépendante de l&apos;avancement Atelier. Chaque ouvrage ou zone suit simplement À faire / En cours / Terminé, avec une note facultative.</p>{items.length === 0 ? <OperationalEmpty label="Aucun ouvrage prévu en Pose pour le moment." /> : <div className="chantierInstallRows">{items.map((item) => <InstallRow key={item.id} chantier={chantier} item={item} busy={busy} canModify={canModify} mutate={mutate} />)}</div>}</div>;
}

function InstallRow({ chantier, item, busy, canModify, mutate }: Props & { item: InstallItem }) {
  const [status, setStatus] = useState<InstallItemStatus>(item.status); const [note, setNote] = useState(item.note ?? "");
  return <div className="chantierInstallRow"><div className="chantierOpRowMain"><strong>{item.name}</strong><span>{originLabel(item.originKind, item.originLabel)}{item.sourceBeItemId ? " · Issu du BE" : " · Issu Atelier"}</span></div><select value={status} disabled={!canModify || busy} onChange={(event) => setStatus(event.target.value as InstallItemStatus)}>{Object.entries(INSTALL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea rows={2} value={note} disabled={!canModify || busy} onChange={(event) => setNote(event.target.value)} placeholder="Note terrain facultative" />{canModify ? <button type="button" disabled={busy} onClick={() => void mutate({ action: "setInstallStatus", chantierId: chantier.id, installItemId: item.id, status, note }, "Suivi Pose enregistré.")}><Save size={14} /> Enregistrer</button> : null}<StatusPill value={INSTALL_STATUS_LABELS[item.status]} done={item.status === "DONE"} /></div>;
}

function TechnicalCreateForm({ mode, busy, onCancel, onCreate }: { mode: "be" | "workshop"; busy: boolean; onCancel: () => void; onCreate: (value: { name: string; originKind: TechnicalOrigin; originLabel: string; installedByUs: boolean }) => Promise<void> }) {
  const [name, setName] = useState(""); const [originKind, setOriginKind] = useState<TechnicalOrigin>("QUOTE_LINE"); const [originLabelValue, setOriginLabelValue] = useState(""); const [installedByUs, setInstalledByUs] = useState(true); const originReady = originKind === "TS" || Boolean(originLabelValue.trim());
  return <div className="chantierTechnicalCreate"><div className="chantierTechnicalCreateTitle"><strong>{mode === "be" ? "Nouvel élément BE" : "Nouvel élément direct Atelier"}</strong><span>Chaque élément doit rester relié à une ligne du devis ou être identifié comme TS.</span></div><label><span>Nom *</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Banque accueil, meuble arrière-bar…" /></label><label><span>Origine *</span><select value={originKind} onChange={(event) => setOriginKind(event.target.value as TechnicalOrigin)}><option value="QUOTE_LINE">Ligne de devis</option><option value="TS">Travaux supplémentaires (TS)</option></select></label><label className="isWide"><span>{originKind === "QUOTE_LINE" ? "Repère / ligne du devis *" : "Description TS (facultative si le nom suffit)"}</span><input value={originLabelValue} onChange={(event) => setOriginLabelValue(event.target.value)} placeholder={originKind === "QUOTE_LINE" ? "Ex. 1.2 Façade de magasin" : "Ex. ajout tablette demandé en réunion"} /></label><label className="chantierTechnicalCheck"><input type="checkbox" checked={installedByUs} onChange={(event) => setInstalledByUs(event.target.checked)} /> Ouvrage posé par PAPOT</label>{originKind === "QUOTE_LINE" ? <p>Le repère est saisi manuellement pour l&apos;instant. Le sélecteur des lignes extraites du bordereau OBAT sera raccordé ensuite.</p> : null}<div className="chantierTechnicalActions"><button type="button" onClick={onCancel}>Annuler</button><button type="button" className="isPrimary" disabled={busy || !name.trim() || !originReady} onClick={() => void onCreate({ name, originKind, originLabel: originLabelValue, installedByUs })}><Plus size={14} /> Créer</button></div></div>;
}

function StatusPill({ value, done }: { value: string; done: boolean }) { return <span className={`chantierOpStatus${done ? " isDone" : ""}`}>{value}</span>; }
function OperationalEmpty({ label }: { label: string }) { return <div className="chantierOpEmpty"><FolderOpen size={24} /><strong>{label}</strong></div>; }
function FutureSpace({ id }: { id: Exclude<SpaceId, "be" | "workshop" | "install"> }) { const title = CHANTIER_OPERATIONAL_SPACES.find((item) => item.id === id)?.label ?? id; return <div className="chantierFutureSpace"><span>{id === "meeting" ? <Users size={21} /> : id === "mail" ? <Mail size={21} /> : id === "reception" ? <CheckCircle2 size={21} /> : <BriefcaseBusiness size={21} />}</span><strong>{title}</strong><p>{spaceDescriptions[id]}</p><small>Cette rubrique est déjà réservée dans la fiche chantier. Son contenu métier sera raccordé dans une prochaine étape.</small></div>; }

function OperationalStyles() { return <style jsx global>{`
.chantierOperationalWorkspace{padding:16px;display:grid;gap:14px;border:1px solid #e9e5f0;border-radius:11px;background:#fff}.chantierOperationalHeader>div{display:grid;gap:4px}.chantierOperationalHeader strong{font-size:15px;color:#514c59}.chantierOperationalHeader span{max-width:850px;color:#817b88;font-size:12px;line-height:1.45}.chantierOperationalTabs{padding:6px;display:flex;gap:5px;overflow-x:auto;border:1px solid #e3deed;border-radius:10px;background:#faf8ff}.chantierOperationalTabs button{min-height:40px;padding:0 12px;display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;border:1px solid transparent;border-radius:8px;background:transparent;color:#706978;font-size:12px;font-weight:750}.chantierOperationalTabs button:hover{background:white;color:#5f51a1}.chantierOperationalTabs button.isActive{border-color:#a894ec;background:white;color:#6551c7;box-shadow:0 2px 8px rgb(87 67 150 / .08)}.chantierOperationalTabs small{min-width:21px;padding:2px 6px;border-radius:999px;background:#eeeaf6;color:#766c86;font-size:10px;text-align:center}.chantierOperationalTabBody{min-height:320px}.chantierOpSpace{display:grid;gap:12px}.chantierOpSpaceTitle{display:flex;align-items:center;justify-content:space-between;gap:10px}.chantierOpSpaceTitle>div{display:flex;align-items:center;gap:8px;color:#5c50b3}.chantierOpSpaceTitle>div>span{display:grid;gap:2px}.chantierOpSpaceTitle strong{font-size:15px;color:#4f4956}.chantierOpSpaceTitle small{color:#918b97;font-size:11px}.chantierOpSpaceTitle>button{min-height:36px;padding:0 11px;display:inline-flex;align-items:center;gap:6px;border:1px solid #a998e4;border-radius:7px;background:#f7f3ff;color:#6351bf;font-size:12px;font-weight:750}.chantierOpHint{margin:0;color:#817b88;font-size:12px;line-height:1.45}.chantierOpRows,.chantierInstallRows{display:grid;gap:8px}.chantierOpRow{padding:11px 12px;display:grid;grid-template-columns:minmax(0,1fr) 180px auto;gap:9px;align-items:center;border:1px solid #ece8f1;border-radius:8px;background:#fdfcff}.chantierOpRowMain{min-width:0;display:grid;gap:3px}.chantierOpRowMain strong{font-size:13px;color:#4e4954}.chantierOpRowMain span{overflow:hidden;color:#817b88;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.chantierOpRow select,.chantierInstallRow select,.chantierTechnicalCreate select,.chantierTechnicalCreate input,.chantierInstallRow textarea{width:100%;padding:9px 10px;border:1px solid #ddd8e5;border-radius:7px;background:#fff;color:#57515e;font:inherit;font-size:12px}.chantierOpStatus{padding:5px 8px;border-radius:999px;background:#f0edf5;color:#766e80;font-size:11px;font-weight:750;white-space:nowrap}.chantierOpStatus.isDone{background:#e9f6ed;color:#3b7b55}.chantierOpEmpty{min-height:150px;display:grid;place-items:center;align-content:center;gap:7px;border:1px dashed #ddd7e7;border-radius:9px;background:#fcfbfd;color:#9d97a1}.chantierOpEmpty strong{font-size:12px}.chantierTechnicalCreate{padding:13px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;border:1px solid #dcd3f1;border-radius:9px;background:#faf8ff}.chantierTechnicalCreateTitle{grid-column:1/-1;display:grid;gap:3px}.chantierTechnicalCreateTitle strong{font-size:14px}.chantierTechnicalCreateTitle span{color:#817b88;font-size:11px}.chantierTechnicalCreate label{display:grid;gap:5px}.chantierTechnicalCreate label>span{font-size:11px;font-weight:750;color:#615a68}.chantierTechnicalCreate label.isWide{grid-column:1/-1}.chantierTechnicalCheck{grid-column:1/-1;display:flex!important;grid-template-columns:auto 1fr!important;align-items:center;justify-content:flex-start;gap:7px!important;color:#615a68;font-size:12px}.chantierTechnicalCheck input{width:auto!important}.chantierTechnicalCreate>p{grid-column:1/-1;margin:0;color:#916a31;font-size:11px}.chantierTechnicalActions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:7px}.chantierTechnicalActions button,.chantierInstallRow>button{min-height:35px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #ddd8e5;border-radius:7px;background:#fff;color:#625b69;font-size:12px}.chantierTechnicalActions button.isPrimary,.chantierInstallRow>button{border-color:#8e7bd9;background:#8e7bd9;color:white;font-weight:750}.chantierInstallRow{padding:11px;display:grid;grid-template-columns:minmax(0,1fr) 150px minmax(190px,.7fr) auto auto;gap:9px;align-items:center;border:1px solid #ece8f1;border-radius:8px;background:#fdfcff}.chantierInstallRow textarea{resize:vertical}.chantierFutureSpace{min-height:260px;display:grid;place-items:center;align-content:center;gap:8px;border:1px dashed #ded8e7;border-radius:10px;background:#fcfbfd;text-align:center}.chantierFutureSpace>span{width:44px;height:44px;display:grid;place-items:center;border-radius:11px;background:#eee9ff;color:#6855c1}.chantierFutureSpace strong{font-size:15px}.chantierFutureSpace p{max-width:560px;margin:0;color:#746e7a;font-size:12px}.chantierFutureSpace small{color:#8f8993;font-size:11px}.chantierOpSpaceTitle button:disabled,.chantierTechnicalActions button:disabled,.chantierInstallRow>button:disabled{opacity:.55}@media(max-width:900px){.chantierOpRow{grid-template-columns:minmax(0,1fr) 160px}.chantierOpStatus{grid-column:1/-1;width:max-content}.chantierInstallRow{grid-template-columns:1fr 160px}.chantierInstallRow textarea,.chantierInstallRow>button,.chantierInstallRow>.chantierOpStatus{grid-column:1/-1}.chantierInstallRow>button{width:max-content}.chantierTechnicalCreate{grid-template-columns:1fr}.chantierTechnicalCreateTitle,.chantierTechnicalCreate label.isWide,.chantierTechnicalCheck,.chantierTechnicalCreate>p,.chantierTechnicalActions{grid-column:auto}}@media(max-width:620px){.chantierOpSpaceTitle{flex-direction:column;align-items:stretch}.chantierOpRow,.chantierInstallRow{grid-template-columns:1fr}.chantierOpRow select,.chantierInstallRow select{grid-column:1/-1}.chantierOperationalTabs{gap:3px}.chantierOperationalTabs button{padding:0 9px}}
`}</style>; }
