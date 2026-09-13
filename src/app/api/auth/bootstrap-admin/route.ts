import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MODULE_PERMISSIONS, SPECIAL_PERMISSIONS } from "@/lib/auth/permission-catalog";
import { hashPassword } from "@/lib/auth/password";
import { authHasUsers, mutateAuthPayload } from "@/lib/auth/store";

const schema = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(240),
  password: z.string().min(12).max(512),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Nom, e-mail ou mot de passe invalide. Le mot de passe doit contenir au moins 12 caractères." },
      { status: 400 },
    );
  }

  if (await authHasUsers()) {
    return NextResponse.json({ error: "L’administrateur initial existe déjà." }, { status: 409 });
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);
  await mutateAuthPayload(id, (payload) => {
    if (payload.users.length > 0) throw new Error("INITIAL_ADMIN_ALREADY_EXISTS");
    payload.users.push({
      id,
      displayName: parsed.data.displayName,
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      isActive: true,
      canManagePermissions: true,
      mustChangePassword: false,
      accentKey: "lavender",
      modulePermissions: Object.fromEntries(
        MODULE_PERMISSIONS.map((module) => [module.key, "WRITE" as const]),
      ),
      specialPermissions: SPECIAL_PERMISSIONS.map((permission) => permission.key),
    });
  });

  return NextResponse.json({ ok: true });
}
