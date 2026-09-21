import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function CapturePage() {
  await requireUser();
  redirect("/entrees");
}
