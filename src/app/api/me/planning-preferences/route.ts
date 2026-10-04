import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    planningPotentialCollapsed?: unknown;
    expectedPlanningPotentialCollapsed?: unknown;
  } | null;
  if (typeof body?.planningPotentialCollapsed !== "boolean") {
    return NextResponse.json({ error: "Préférence invalide." }, { status: 400 });
  }
  if (typeof body.expectedPlanningPotentialCollapsed !== "boolean") {
    return NextResponse.json({ error: "PREFERENCE_VERSION_REQUIRED" }, { status: 428 });
  }
  const planningPotentialCollapsed = body.planningPotentialCollapsed;

  try {
    await mutateAuthPayload(user.id, (payload) => {
    const target = payload.users.find(
      (candidate) => candidate.id === user.id && candidate.isActive,
    );
      if (!target) throw new Error("AUTH_USER_NOT_FOUND");
      const current = target.planningPotentialCollapsed ?? false;
      if (current !== body.expectedPlanningPotentialCollapsed) {
        throw new Error("PREFERENCE_VERSION_CONFLICT");
      }
      target.planningPotentialCollapsed = planningPotentialCollapsed;
    });

    return NextResponse.json({ ok: true, planningPotentialCollapsed });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PREFERENCE_UPDATE_FAILED";
    if (code === "PREFERENCE_VERSION_CONFLICT") {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    throw error;
  }
}
