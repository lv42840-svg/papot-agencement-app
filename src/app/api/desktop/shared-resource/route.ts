import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { sharedResourceRefSchema, type SharedResourceType } from "@/lib/sync/resource-lock";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    resource: sharedResourceRefSchema,
    leaseId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("save"),
    resource: sharedResourceRefSchema,
    leaseId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.unknown(),
  }),
  z.object({
    action: z.literal("renew"),
    resource: sharedResourceRefSchema,
    leaseId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("release"),
    resource: sharedResourceRefSchema,
    leaseId: z.string().uuid(),
  }),
]);

function moduleForResource(resourceType: SharedResourceType): string {
  switch (resourceType) {
    case "ENTRIES":
      return "capture";
    case "COMMERCIAL":
      return "commercial";
    case "CHANTIER":
      return "chantiers";
    case "PLANNING_WEEK":
      return "planning";
    case "TREASURY_MONTH":
      return "treasury";
    case "AUTH":
      throw new Error("SHARED_RESOURCE_AUTH_INTERNAL_ONLY");
  }
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const requiredAccess = input.action === "open" ? "READ" : "WRITE";
    const context = await requireDesktopRequestContext(
      moduleForResource(input.resource.resource_type),
      requiredAccess,
    );
    const { desktop, owner } = context;

    if (input.action === "open") {
      return NextResponse.json(
        await desktop.coordinator.open({
          resource: input.resource,
          leaseId: input.leaseId,
          owner,
        }),
      );
    }
    if (input.action === "save") {
      return NextResponse.json(
        await desktop.coordinator.save({
          resource: input.resource,
          leaseId: input.leaseId,
          owner,
          expectedVersion: input.expectedVersion,
          payload: input.payload,
        }),
      );
    }
    if (input.action === "renew") {
      const lock = await desktop.locks.renew({
        resource: input.resource,
        leaseId: input.leaseId,
        owner,
      });
      return NextResponse.json({ status: "renewed", lock });
    }

    return NextResponse.json({
      status: "released",
      released: await desktop.coordinator.release({
        resource: input.resource,
        leaseId: input.leaseId,
        owner,
      }),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHARED_RESOURCE_FAILED";
    const requestStatus = desktopRequestErrorStatus(code);
    return NextResponse.json(
      { status: "error", error: code },
      { status: requestStatus ?? 409 },
    );
  }
}
