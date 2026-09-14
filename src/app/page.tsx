import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasDesktopDatabaseConfig } from "@/lib/desktop/database-config";

export default async function HomePage() {
  if (!hasDesktopDatabaseConfig()) redirect("/desktop-server-required");
  await requireUser();
  redirect("/desktop-ready");
}
