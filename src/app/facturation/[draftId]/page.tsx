import { DesktopAppShell } from "@/components/desktop-app-shell";
import { BillingDocumentEditor } from "@/components/billing-document-editor";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function InvoiceDraftPage({
  params: parametres,
}: {
  params: Promise<{ draftId: string }>;
}) {
  await requireModuleRequestContext("billing", "READ");
  const { draftId: idBrouillon } = await parametres;
  return (
    <DesktopAppShell>
      <BillingDocumentEditor draftId={idBrouillon} />
    </DesktopAppShell>
  );
}
