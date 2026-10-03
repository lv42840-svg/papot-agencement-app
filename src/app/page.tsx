import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function HomePage() {
  await requireUser();
  redirect("/desktop-ready");
}
