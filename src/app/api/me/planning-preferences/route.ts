import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | { planningPotentialCollapsed?: unknown }
    | null;
  if (typeof body?.planningPotentialCollapsed !== "boolean") {
    return NextResponse.json({ error: "Préférence invalide." }, { status: 400 });
  }

  await mutateAuthPayload(user.id, (payload) => {
    const target = payload.users.find(
      (candidate) => candidate.id === user.id && candidate.isActive,
    );
    if (!target) throw new Error("AUTH_USER_NOT_FOUND");
    target.planningPotentialCollapsed = body.planningPotentialCollapsed;
  });

  return NextResponse.json({ ok: true });
}
