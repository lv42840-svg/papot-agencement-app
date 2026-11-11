import "./mobile.css";
import { MobileEntryCapture } from "@/components/mobile-entry-capture";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const utilisateur = await requireUser();
  return <MobileEntryCapture userId={utilisateur.id} />;
}
