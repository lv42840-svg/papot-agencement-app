import { DesktopAppShell } from "@/components/desktop-app-shell";
import { BillingDocumentEditor } from "@/components/billing-document-editor";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function InvoiceDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  await requireModuleRequestContext("billing", "READ");
  const { draftId } = await params;
  return (
    <DesktopAppShell>
      <BillingDocumentEditor draftId={draftId} />
    </DesktopAppShell>
  );
}
