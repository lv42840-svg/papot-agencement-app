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

const moduleKeys = new Set<string>(MODULE_PERMISSIONS.map((item) => item.key));
const specialKeys = new Set<string>(SPECIAL_PERMISSIONS.map((item) => item.key));
const moduleKeySchema = z.string().refine((value) => moduleKeys.has(value));
const specialKeySchema = z.string().refine((value) => specialKeys.has(value));

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(240),
    temporaryPassword: z.string().min(12).max(512),
  }),
  z.object({
    action: z.literal("updateProfile"),
    userId: z.string().uuid(),
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
    temporaryPassword: z.string().min(12).max(512),
  }),
  z.object({
    action: z.literal("revokeSession"),
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
  }),
]);

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
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
    const actor = await requirePermissionAdministrator();
    return noStoreJson(await snapshot(actor.id));
  } catch (error) {
    const code = error instanceof Error ? error.message : "USER_ADMIN_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermissionAdministrator();
    const input = mutationSchema.parse(await request.json().catch(() => null));

    switch (input.action) {
      case "create":
        await createManagedUser(input);
        break;
      case "updateProfile":
        await updateManagedUserProfile(input);
        break;
      case "setActive":
        await setManagedUserActive({ ...input, actorUserId: actor.id });
        break;
      case "replacePermissions":
        await replaceManagedUserPermissions(input);
        break;
      case "resetPassword":
        await resetManagedUserPassword(input);
        break;
      case "revokeSession":
        await revokeManagedUserSession(input);
        break;
    }

    return noStoreJson(await snapshot(actor.id));
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "USER_ADMIN_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "USER_ADMIN_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: userAdminErrorStatus(code) });
  }
}
