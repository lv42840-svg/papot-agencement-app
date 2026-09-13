import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { createSession, getCurrentUser } from "@/lib/auth/session";
import { mutateAuthPayload } from "@/lib/auth/store";

const schema = z.object({
  password: z.string().min(12).max(512),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Le nouveau mot de passe doit contenir au moins 12 caractères." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await mutateAuthPayload(user.id, (payload) => {
    const target = payload.users.find(
      (candidate) => candidate.id === user.id && candidate.isActive,
    );
    if (!target) throw new Error("AUTH_USER_NOT_FOUND");
    target.passwordHash = passwordHash;
    target.mustChangePassword = false;
    payload.sessions = payload.sessions.filter((session) => session.userId !== user.id);
  });
  await createSession(user.id);

  return NextResponse.json({ ok: true });
}
