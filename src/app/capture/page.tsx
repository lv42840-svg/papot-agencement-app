import "./mobile.css";
import { MobileEntryCapture } from "@/components/mobile-entry-capture";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const user = await requireUser();
  return <MobileEntryCapture userId={user.id} />;
}
