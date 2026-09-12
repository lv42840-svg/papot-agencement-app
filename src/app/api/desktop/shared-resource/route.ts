import { NextResponse } from "next/server";
import { z } from "zod";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { sharedResourceRefSchema } from "@/lib/sync/resource-lock";

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

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const runtime = createDesktopSharedResourceRuntime();

    if (input.action === "open") {
      return NextResponse.json(
        await runtime.coordinator.open({
          resource: input.resource,
          leaseId: input.leaseId,
          owner: runtime.owner,
        }),
      );
    }
    if (input.action === "save") {
      return NextResponse.json(
        await runtime.coordinator.save({
          resource: input.resource,
          leaseId: input.leaseId,
          owner: runtime.owner,
          expectedVersion: input.expectedVersion,
          payload: input.payload,
        }),
      );
    }
    if (input.action === "renew") {
      const lock = await runtime.locks.renew({
        resource: input.resource,
        leaseId: input.leaseId,
        owner: runtime.owner,
      });
      return NextResponse.json({ status: "renewed", lock });
    }

    return NextResponse.json({
      status: "released",
      released: await runtime.coordinator.release({
        resource: input.resource,
        leaseId: input.leaseId,
        owner: runtime.owner,
      }),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHARED_RESOURCE_FAILED";
    return NextResponse.json({ status: "error", error: code }, { status: 409 });
  }
}
