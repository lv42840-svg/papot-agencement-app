from pathlib import Path

changed = set()

def edit(name, before, after, count=1):
    path = Path(name)
    source = path.read_text()
    found = source.count(before)
    if found != count:
        raise RuntimeError(f'{name}: expected {count} anchors, found {found}: {before[:100]}')
    path.write_text(source.replace(before, after))
    changed.add(name)

p = 'src/lib/chantiers/domain.ts'
edit(p, 'z.enum(["ACTIVE", "DONE", "ARCHIVED"])', 'z.enum(["ACTIVE", "DONE", "CANCELLED", "ARCHIVED"])')
edit(p, '    "MARKED_DONE",', '    "MARKED_DONE",\n    "CANCELLED",')
edit(p, '  DONE: "Terminé",', '  DONE: "Terminé",\n  CANCELLED: "Annulé",')

p = 'src/lib/chantiers/mutations.ts'
edit(p, '  z.object({\n    action: z.literal("reactivate"),', '''  z.object({
    action: z.literal("cancel"),
    chantierId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
  }),
  z.object({
    action: z.literal("reactivate"),''')
edit(p, '  const item = findChantier(payload, input.chantierId);\n', '''  const item = findChantier(payload, input.chantierId);

  // Cancellation preserves the dossier but stops operational changes until reopening.
  if (item.status === "CANCELLED" && input.action !== "reactivate" && input.action !== "archive") {
    throw new Error("CHANTIER_CANCELLED_READ_ONLY");
  }
''')
edit(p, '  if (input.action === "reactivate") {\n', '''  if (input.action === "cancel") {
    if (item.status !== "ACTIVE") throw new Error("CHANTIER_NOT_ACTIVE");
    if (input.confirmed !== true) throw new Error("CHANTIER_CANCELLATION_CONFIRMATION_REQUIRED");
    const reason = input.reason.trim();
    if (!reason || reason.length > 1000) throw new Error("CHANTIER_CANCELLATION_REASON_REQUIRED");
    item.status = "CANCELLED";
    // Do not mark unfinished work as completed and do not erase hours or quote links.
    item.completedAt = null;
    touch(item, actor, now);
    history(item, actor.displayName, "CANCELLED", `Chantier annulé. Motif : ${reason}`, now);
    return { payload, focusChantierId: item.id };
  }

  if (input.action === "reactivate") {
''')
edit(p, '    if (item.status !== "DONE") throw new Error("CHANTIER_NOT_DONE");', '    if (item.status !== "DONE" && item.status !== "CANCELLED") throw new Error("CHANTIER_NOT_DONE");', count=2)

p = 'src/lib/auth/action-permissions.ts'
edit(p, 'if (input.action === "markDone" || input.action === "reactivate")', 'if (input.action === "markDone" || input.action === "cancel" || input.action === "reactivate")')

p = 'src/app/api/desktop/chantiers/route.ts'
edit(p, '      input.action === "markDone" ||\n      input.action === "reactivate"', '      input.action === "markDone" ||\n      input.action === "cancel" ||\n      input.action === "reactivate"')
edit(p, '        if (input.action === "markDone") {', '        if (input.action === "markDone" || input.action === "cancel") {')

p = 'src/components/chantiers-workspace.tsx'
edit(p, 'type ViewMode = "ACTIVE" | "DONE" | "ARCHIVED";', 'type ViewMode = "ACTIVE" | "DONE" | "CANCELLED" | "ARCHIVED";')
edit(p, '  if (item.status === "DONE") return "done";', '  if (item.status === "DONE") return "done";\n  if (item.status === "CANCELLED") return "cancelled";')
edit(p, '    archived: chantiers.filter((item) => item.status === "ARCHIVED").length,', '    archived: chantiers.filter((item) => item.status === "ARCHIVED").length,\n    cancelled: chantiers.filter((item) => item.status === "CANCELLED").length,')
edit(p, '          <button\n            className={mode === "ARCHIVED" ? "isActive" : undefined}', '''          <button
            className={mode === "CANCELLED" ? "isActive" : undefined}
            type="button"
            onClick={() => setMode("CANCELLED")}
          >
            Annulés ({counts.cancelled})
          </button>
          <button
            className={mode === "ARCHIVED" ? "isActive" : undefined}''')
edit(p, '      .chantiersWorkspace {', '''      .chantierStatus-cancelled {
        background: #fff0ec;
        color: #a3493a;
      }
      .chantiersWorkspace {''')
edit(p, 'Affaires lancées, suivi opérationnel et cycle Actif → Terminé → Archivé.', 'Affaires lancées, suivi opérationnel, clôture, annulation et archives.')

p = 'src/components/chantier-workspace.tsx'
edit(p, '  BadgeEuro,', '  BadgeEuro,\n  Ban,')
edit(p, '  CHANTIER_NOT_DONE: "Cette action nécessite un chantier au statut Terminé.",', '''  CHANTIER_NOT_DONE: "Cette action nécessite un chantier terminé ou annulé.",
  CHANTIER_CANCELLED_READ_ONLY: "Ce chantier est annulé. Rouvre-le avant de modifier ses données.",
  CHANTIERS_VERSION_REQUIRED: "La version du chantier manque. Actualise la fiche avant de réessayer.",
  CHANTIERS_REQUEST_INVALID: "Vérifie le motif et la confirmation de l’action.",''')
edit(p, '  if (item.status === "DONE") return "done";', '  if (item.status === "DONE") return "done";\n  if (item.status === "CANCELLED") return "cancelled";')
# Both callbacks now submit optimistic concurrency revisions. An explicitly supplied
# revision (for a form opened earlier) must not be silently replaced by a newer one.
edit(p, '''      const response = await fetch("/api/desktop/chantiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });''', '''      const current = chantiersSnapshot?.payload.chantiers.find(
        (item) => item.id === body.chantierId,
      );
      if (!current) throw new Error("CHANTIER_NOT_FOUND");
      const response = await fetch("/api/desktop/chantiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          expectedUpdatedAt: body.expectedUpdatedAt ?? current.updatedAt,
        }),
      });''')
edit(p, '  }, []);\n\n  if (loading && !chantiersSnapshot)', '  }, [chantiersSnapshot]);\n\n  if (loading && !chantiersSnapshot)')
# Block operational controls after cancellation; lifecycle controls remain available.
edit(p, 'canModify={chantiersSnapshot.capabilities.canModify && chantier.status !== "ARCHIVED"}', 'canModify={chantiersSnapshot.capabilities.canModify && chantier.status !== "ARCHIVED" && chantier.status !== "CANCELLED"}', count=2)
edit(p, 'canModify={capabilities.canModify && chantier.status !== "ARCHIVED"}', 'canModify={capabilities.canModify && chantier.status !== "ARCHIVED" && chantier.status !== "CANCELLED"}')
edit(p, '<span className="chantierWarningPill">Devis signé manquant</span>', '<span className="chantierWarningPill">Devis signé manquant</span>')
edit(p, '            chantier.signedQuoteReminder', '            chantier.signedQuoteReminder') if False else None
edit(p, '            Chantier archivé : consultation uniquement tant qu&apos;il n&apos;est pas réactivé.', '            Consultation uniquement. La modification nécessite les droits adaptés et un chantier non annulé, non archivé.') if False else None
# Reset lifecycle forms if another action/reload changes the revision.
edit(p, '          <LifecycleTab\n            chantier={chantier}', '          <LifecycleTab\n            key={`${chantier.id}:${chantier.updatedAt}`}\n            chantier={chantier}')
edit(p, '  const [closeReason, setCloseReason] = useState("");', '''  const [closingAction, setClosingAction] = useState<"close" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [closeReason, setCloseReason] = useState("");''')
source = Path(p).read_text()
start = source.index('      {chantier.status === "ACTIVE" && capabilities.canCloseReopen ? (')
end = source.index('      {chantier.status === "DONE" && canManageDoneLifecycle ? (', start)
new = '''      {chantier.status === "ACTIVE" && capabilities.canCloseReopen ? (
        <div className="chantierLifecycleAction">
          <p>
            Clôturer indique que les travaux principaux sont terminés. Annuler indique que le
            chantier est abandonné ou a été lancé par erreur. Aucun dossier n’est supprimé.
          </p>
          <div className="chantierLifecycleChoices">
            <button
              type="button"
              className="secondaryButton"
              aria-pressed={closingAction === "close"}
              disabled={busy}
              onClick={() => { setClosingAction("close"); setCancelConfirmed(false); }}
            >
              <CheckCircle2 size={15} /> Clôturer le chantier
            </button>
            <button
              type="button"
              className="chantierArchiveButton"
              aria-pressed={closingAction === "cancel"}
              disabled={busy}
              onClick={() => { setClosingAction("cancel"); setCancelConfirmed(false); }}
            >
              <Ban size={15} /> Annuler le chantier
            </button>
          </div>
          {closingAction ? (
            <div className="chantierLifecycleConfirmation">
              <strong>{closingAction === "cancel" ? "Confirmer l’annulation" : "Confirmer la clôture"}</strong>
              {closeWarning?.hasRemainingCharge ? (
                <div className="chantierLifecycleWarning">
                  <strong>Attention, il reste de la charge dans le Grand planning.</strong>
                  <span>
                    {closeWarningParts.join(" · ")}. Cette action retirera le chantier du planning
                    actif et libérera sa capacité. Les heures déjà réalisées restent conservées.
                  </span>
                </div>
              ) : null}
              {closingAction === "close" ? (
                <>
                  <label className="chantierField">
                    <span>Motif de clôture</span>
                    <input
                      value={closeReason}
                      onChange={(event) => setCloseReason(event.target.value)}
                      maxLength={1000}
                      disabled={busy}
                      placeholder="Motif obligatoire de fermeture"
                    />
                  </label>
                  <button
                    type="button"
                    className="primaryButton chantierFitButton"
                    disabled={busy || !closeReason.trim()}
                    onClick={() => void mutate(
                      { action: "markDone", chantierId: chantier.id, expectedUpdatedAt: chantier.updatedAt, reason: closeReason },
                      "Chantier clôturé : statut Terminé.",
                    )}
                  >
                    <CheckCircle2 size={15} /> Confirmer la clôture
                  </button>
                </>
              ) : (
                <>
                  <p>Les devis, documents, heures réalisées et historique sont conservés. Le chantier sera classé dans « Annulés », pas dans « Terminés ».</p>
                  <label className="chantierField">
                    <span>Motif d’annulation</span>
                    <input
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      maxLength={1000}
                      disabled={busy}
                      placeholder="Ex. abandon du client, chantier de test, lancement par erreur…"
                    />
                  </label>
                  <label className="chantierArchiveCheck">
                    <input type="checkbox" checked={cancelConfirmed} disabled={busy}
                      onChange={(event) => setCancelConfirmed(event.target.checked)} />
                    Je confirme l’annulation de ce chantier et son retrait du planning actif.
                  </label>
                  <button
                    type="button"
                    className="chantierArchiveButton"
                    disabled={busy || !cancelReason.trim() || !cancelConfirmed}
                    onClick={() => void mutate(
                      { action: "cancel", chantierId: chantier.id, expectedUpdatedAt: chantier.updatedAt, reason: cancelReason, confirmed: true },
                      "Chantier annulé. Documents et heures réalisées conservés.",
                    )}
                  >
                    <Ban size={15} /> Confirmer l’annulation
                  </button>
                </>
              )}
              <button type="button" className="secondaryButton chantierFitButton" disabled={busy}
                onClick={() => { setClosingAction(null); setCancelConfirmed(false); }}>
                Retour sans modifier
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {chantier.status === "CANCELLED" ? (
        <div className="chantierLifecycleWarning" role="status">
          <strong>Chantier annulé</strong>
          <span>{[...chantier.history].reverse().find((event) => event.type === "CANCELLED")?.summary}</span>
          <span>Le dossier reste consultable. Une réouverture remettra le chantier en Actif, avec des semaines à replanifier.</span>
        </div>
      ) : null}

'''
source = source[:start] + new + source[end:]
Path(p).write_text(source)
changed.add(p)
edit(p, '{chantier.status === "DONE" && canManageDoneLifecycle ? (', '{(chantier.status === "DONE" || chantier.status === "CANCELLED") && canManageDoneLifecycle ? (')
edit(p, '      .chantierLifecycle-active {', '''      .chantierLifecycle-cancelled {
        background: #fff0ec;
        color: #a3493a;
      }
      .chantierLifecycleChoices {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .chantierLifecycleChoices button,
      .chantierLifecycleConfirmation button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 38px;
      }
      .chantierLifecycleConfirmation {
        display: grid;
        gap: 12px;
        border-top: 1px solid #e9e5f0;
        padding-top: 14px;
      }
      .chantierLifecycleAction .chantierArchiveCheck input {
        width: auto;
        flex: 0 0 auto;
      }
      .chantierLifecycle-active {''')
# Match the read-only explanation to permissions as well as the new cancelled status.
edit(p, '              Chantier archivé : consultation uniquement tant qu&apos;il n&apos;est pas réactivé.', '              Consultation uniquement. Les modifications nécessitent les droits adaptés et un chantier non annulé, non archivé.')

# Behaviour tests, not just string matches: use the real domain mutations and planning reducers.
p = 'tests/chantier-cancellation.test.ts'
Path(p).write_text('''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chantierSpecialPermissionForMutation } from "../src/lib/auth/action-permissions";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createInitialChantiersPayload, parseChantiersPayload, CHANTIER_STATUS_LABELS } from "../src/lib/chantiers/domain";
import { launchChantierFromAffair } from "../src/lib/chantiers/launch-from-affair";
import { applyChantierMutation, assertChantierRevision, chantierMutationSchema } from "../src/lib/chantiers/mutations";
import { createInitialPlanningPayload, buildFirmGrandPlanningRows } from "../src/lib/planning/domain";
import { removeFirmPlanningForChantier, restoreFirmPlanningOrderForChantier } from "../src/lib/planning/mutations";

const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Lucien" };
const closedAt = new Date("2026-10-04T20:00:00.000Z");

function fixture() {
  const commercial = applyCommercialMutation(createInitialCommercialPayload(), {
    action: "create", name: "Chantier de test", clientName: "Client test", siteLabel: "Roanne",
    description: "Cuisine", nextAction: "Préparer", reviewDate: "2026-10-04",
  }, actor).payload;
  const affair = commercial.cases[0];
  affair.status = "CONFIRMED";
  affair.plannedInstallDate = "2026-12-10";
  affair.retainedQuoteIds = ["88888888-8888-4888-8888-888888888888"];
  const payload = launchChantierFromAffair(createInitialChantiersPayload(), affair,
    { commercialCaseId: affair.id, be: 8, workshop: 32, install: 16 }, actor,
    new Date("2026-10-01T08:00:00.000Z")).payload;
  payload.chantiers[0].actualHours = { be: 3, workshop: 4, install: 0 };
  const item = payload.chantiers[0];
  const input = chantierMutationSchema.parse({ action: "cancel", chantierId: item.id, reason: "Abandon du client", confirmed: true });
  return { payload, item, input, commercial };
}

describe("chantier cancellation", () => {
  it("cancels without pretending work is complete or deleting dossier data", () => {
    const { payload, item, input, commercial } = fixture();
    const before = structuredClone(payload);
    const commercialBefore = structuredClone(commercial);
    const result = applyChantierMutation(payload, input, actor, closedAt);
    const cancelled = result.payload.chantiers[0];
    expect(cancelled.status).toBe("CANCELLED");
    expect(CHANTIER_STATUS_LABELS[cancelled.status]).toBe("Annulé");
    expect(cancelled.completedAt).toBeNull();
    expect(cancelled.id).toBe(item.id);
    expect(cancelled.number).toBe(item.number);
    expect(cancelled.sourceCommercialCaseId).toBe(item.sourceCommercialCaseId);
    expect(cancelled.initialRetainedQuoteIds).toEqual(item.initialRetainedQuoteIds);
    expect(cancelled.plannedHours).toEqual(item.plannedHours);
    expect(cancelled.actualHours).toEqual(item.actualHours);
    expect(cancelled.operational).toEqual(item.operational);
    expect(cancelled.launchDocuments).toEqual(item.launchDocuments);
    expect(cancelled.history.slice(0, -1)).toEqual(item.history);
    expect(cancelled.history.at(-1)).toMatchObject({ type: "CANCELLED", actorName: actor.displayName,
      at: closedAt.toISOString(), summary: "Chantier annulé. Motif : Abandon du client" });
    expect(parseChantiersPayload(result.payload).chantiers[0].status).toBe("CANCELLED");
    expect(payload).toEqual(before);
    expect(commercial).toEqual(commercialBefore);
  });

  it("requires a meaningful bounded reason and explicit confirmation", () => {
    const { item } = fixture();
    for (const reason of ["", "  ", "x".repeat(1001)]) {
      expect(chantierMutationSchema.safeParse({ action: "cancel", chantierId: item.id, reason, confirmed: true }).success).toBe(false);
    }
    for (const confirmed of [undefined, false, "true"]) {
      expect(chantierMutationSchema.safeParse({ action: "cancel", chantierId: item.id, reason: "Test", confirmed }).success).toBe(false);
    }
    expect(chantierMutationSchema.safeParse({ action: "cancel", chantierId: item.id, reason: "x".repeat(1000), confirmed: true }).success).toBe(true);
  });

  it("uses the close/reopen permission instead of a new permission bypass", () => {
    for (const action of ["cancel", "markDone", "reactivate"]) {
      expect(chantierSpecialPermissionForMutation({ action })).toBe("chantiers.close_reopen");
    }
    expect(chantierSpecialPermissionForMutation({ action: "archive" })).toBe("chantiers.archive_reactivate");
  });

  it("only cancels active dossiers and prevents repeat cancellations", () => {
    const { payload, input } = fixture();
    for (const status of ["DONE", "ARCHIVED"] as const) {
      const copy = structuredClone(payload);
      copy.chantiers[0].status = status;
      expect(() => applyChantierMutation(copy, input, actor, closedAt)).toThrow("CHANTIER_NOT_ACTIVE");
    }
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    expect(() => applyChantierMutation(cancelled, input, actor, closedAt)).toThrow("CHANTIER_CANCELLED_READ_ONLY");
  });

  it("keeps cancelled operational data read-only until reopening", () => {
    const { payload, input, item } = fixture();
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    for (const mutation of [
      { action: "updatePlannedHours", chantierId: item.id, be: 1, workshop: 1, install: 1, reason: "Test" },
      { action: "setOperationalSpaceState", chantierId: item.id, spaceId: "be", state: "NOT_APPLICABLE" },
      { action: "updateDetails", chantierId: item.id, name: "Changed" },
    ]) {
      expect(() => applyChantierMutation(cancelled, chantierMutationSchema.parse(mutation), actor)).toThrow("CHANTIER_CANCELLED_READ_ONLY");
    }
  });

  it("can reopen or archive a cancelled dossier without changing its identity", () => {
    const { payload, input, item } = fixture();
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    const reopened = applyChantierMutation(cancelled, { action: "reactivate", chantierId: item.id, reason: "Client revient" }, actor).payload;
    expect(reopened.chantiers[0]).toMatchObject({ id: item.id, number: item.number, status: "ACTIVE", actualHours: item.actualHours });
    expect(reopened.chantiers[0].history.some((event) => event.type === "CANCELLED")).toBe(true);
    const archived = applyChantierMutation(cancelled, { action: "archive", chantierId: item.id, openItemsReviewed: true }, actor).payload;
    expect(archived.chantiers[0].status).toBe("ARCHIVED");
    expect(archived.chantiers[0].history.some((event) => event.type === "CANCELLED")).toBe(true);
  });

  it("removes planned capacity but keeps actual hours and other chantiers intact", () => {
    const { payload, input, item } = fixture();
    const otherId = "99999999-9999-4999-8999-999999999999";
    const planning = createInitialPlanningPayload();
    planning.chantierOrder = [item.id, otherId];
    planning.macroAllocations = [
      { chantierId: item.id, activity: "WORKSHOP", week: "2026-W50", hours: 32 },
      { chantierId: otherId, activity: "INSTALL", week: "2026-W50", hours: 8 },
    ];
    planning.actualHours = [{ chantierId: item.id, userId: actor.userId, activity: "BE", week: "2026-W40", hours: 3 }];
    const cancelled = applyChantierMutation(payload, input, actor, closedAt).payload;
    const cleared = removeFirmPlanningForChantier(planning, item.id);
    expect(cleared.macroAllocations).toEqual([planning.macroAllocations[1]]);
    expect(cleared.chantierOrder).toEqual([otherId]);
    expect(cleared.actualHours).toEqual(planning.actualHours);
    expect(buildFirmGrandPlanningRows(cancelled, cleared, 2026)).toEqual([]);
    const reopened = applyChantierMutation(cancelled, { action: "reactivate", chantierId: item.id, reason: "Reprise" }, actor).payload;
    const restored = restoreFirmPlanningOrderForChantier(cleared, item.id);
    expect(restored.chantierOrder).toEqual([item.id, otherId]);
    expect(restored.macroAllocations).toEqual(cleared.macroAllocations);
    expect(restored.actualHours).toEqual(planning.actualHours);
    expect(buildFirmGrandPlanningRows(reopened, restored, 2026)).toHaveLength(1);
  });

  it("does not accept an obsolete dossier revision", () => {
    const { item } = fixture();
    expect(() => assertChantierRevision(item, "2026-01-01T00:00:00.000Z")).toThrow("CHANTIERS_VERSION_CONFLICT");
    expect(() => assertChantierRevision(item, item.updatedAt)).not.toThrow();
  });

  it("wires the cancellation and required revision into the UI and API", () => {
    const ui = readFileSync(new URL("../src/components/chantier-workspace.tsx", import.meta.url), "utf8");
    const api = readFileSync(new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url), "utf8");
    const list = readFileSync(new URL("../src/components/chantiers-workspace.tsx", import.meta.url), "utf8");
    expect(ui).toContain("expectedUpdatedAt: body.expectedUpdatedAt ?? current.updatedAt");
    expect(ui).toContain("Confirmer l’annulation");
    expect(ui).toContain("Clôturer le chantier");
    expect(ui).toContain("!cancelConfirmed");
    expect(ui).toContain("confirmed: true");
    expect(api).toContain('input.action === "markDone" || input.action === "cancel"');
    expect(api).toContain("assertChantierRevision(openedChantier, expectedUpdatedAt)");
    expect(list).toContain('setMode("CANCELLED")');
  });
});
''')
changed.add(p)

Path('/tmp/chantier-changed-files.txt').write_text('\n'.join(sorted(changed))+'\n')
print('Changed files:\n'+'\n'.join(sorted(changed)))
