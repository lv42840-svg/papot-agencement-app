import { AppShell } from "@/components/app-shell";
import { CaptureForm } from "@/components/capture-form";
import { requireUser } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/permissions";
import { listActiveTags, listCaptureUsers } from "@/lib/capture/repository";

export default async function CapturePage() {
  const user = await requireUser();
  const canWrite = await hasModuleAccess(user.id, "capture", "WRITE");
  const [users, tags] = await Promise.all([listCaptureUsers(), listActiveTags()]);

  return (
    <AppShell user={user}>
      {canWrite ? (
        <CaptureForm currentUserId={user.id} users={users} tags={tags.map((tag) => ({ id: tag.id, label: tag.label }))} />
      ) : (
        <section className="panel"><h1>Capture</h1><p>Vous n’avez pas le droit de créer une capture.</p></section>
      )}
    </AppShell>
  );
}
