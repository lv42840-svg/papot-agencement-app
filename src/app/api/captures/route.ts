import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/permissions";
import { captureCreateSchema } from "@/lib/capture/schema";
import { createCapture } from "@/lib/capture/repository";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!(await hasModuleAccess(user.id, "capture", "WRITE"))) {
    return NextResponse.json({ error: "Accès insuffisant." }, { status: 403 });
  }

  const parsed = captureCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "La capture est incomplète ou invalide." }, { status: 400 });
  }

  try {
    const result = await createCapture(parsed.data, user.id);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_RESPONSIBLE" || code === "INVALID_TAG") {
      return NextResponse.json({ error: "Une valeur sélectionnée n’est plus disponible." }, { status: 409 });
    }
    console.error("capture_create_failed", error);
    return NextResponse.json({ error: "Impossible d’enregistrer la capture." }, { status: 500 });
  }
}
