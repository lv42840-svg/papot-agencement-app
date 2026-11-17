import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401, headers });
  }
  return NextResponse.json(
    { id: user.id, username: user.username, displayName: user.displayName },
    { headers },
  );
}
