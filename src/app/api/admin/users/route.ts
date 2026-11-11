import { NextResponse } from "next/server";
import { z } from "zod";
import { MODULE_PERMISSIONS, SPECIAL_PERMISSIONS } from "@/lib/auth/permission-catalog";
import {
  createManagedUser,
  listAdminUsers,
  replaceManagedUserPermissions,
  requirePermissionAdministrator,
  resetManagedUserPassword,
  revokeManagedUserSession,
  setManagedUserActive,
  updateManagedUserProfile,
  userAdminErrorStatus,
} from "@/lib/auth/user-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const moduleKeys = new Set<string>(MODULE_PERMISSIONS.map((element) => element.key));
const specialKeys = new Set<string>(SPECIAL_PERMISSIONS.map((element) => element.key));
const moduleKeySchema = z.string().refine((valeur) => moduleKeys.has(valeur));
const specialKeySchema = z.string().refine((valeur) => specialKeys.has(valeur));

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    username: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(240),
  }),
  z.object({
    action: z.literal("updateProfile"),
    userId: z.string().uuid(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(240),
  }),
  z.object({
    action: z.literal("setActive"),
    userId: z.string().uuid(),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal("replacePermissions"),
    userId: z.string().uuid(),
    modules: z.array(
      z.object({ moduleKey: moduleKeySchema, accessLevel: z.enum(["READ", "WRITE"]) }),
    ),
    specialPermissions: z.array(specialKeySchema),
  }),
  z.object({
    action: z.literal("resetPassword"),
    userId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("revokeSession"),
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
  }),
]);

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

async function snapshot(actorUserId: string) {
  return {
    users: await listAdminUsers(),
    modules: MODULE_PERMISSIONS,
    specialPermissions: SPECIAL_PERMISSIONS,
    actorUserId,
  };
}

export async function GET() {
  try {
    const auteur = await requirePermissionAdministrator();
    return noStoreJson(await snapshot(auteur.id));
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "USER_ADMIN_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}

export async function POST(requete: Request) {
  try {
    const auteur = await requirePermissionAdministrator();
    const saisie = mutationSchema.parse(await requete.json().catch(() => null));

    let setup: { setupUrl: string; expiresAt: string } | null = null;
    switch (saisie.action) {
      case "create": {
        const created = await createManagedUser(saisie);
        setup = { setupUrl: created.setupUrl, expiresAt: created.expiresAt };
        break;
      }
      case "updateProfile":
        await updateManagedUserProfile(saisie);
        break;
      case "setActive":
        await setManagedUserActive({ ...saisie, actorUserId: auteur.id });
        break;
      case "replacePermissions":
        await replaceManagedUserPermissions(saisie);
        break;
      case "resetPassword":
        setup = await resetManagedUserPassword(saisie);
        break;
      case "revokeSession":
        await revokeManagedUserSession(saisie);
        break;
    }

    return noStoreJson({ ...(await snapshot(auteur.id)), ...(setup ?? {}) });
  } catch (erreur) {
    const code =
      erreur instanceof z.ZodError
        ? "USER_ADMIN_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "USER_ADMIN_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}
