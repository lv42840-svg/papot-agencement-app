import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createLibraryRepository } from "@/lib/library/create-repository";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    leaseId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("save"),
    leaseId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.unknown(),
  }),
  z.object({
    action: z.literal("renew"),
    leaseId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("release"),
    leaseId: z.string().uuid(),
  }),
]);

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("quotes", "READ");
    return NextResponse.json(await createLibraryRepository(context).load());
  } catch (error) {
    const code = error instanceof Error ? error.message : "LIBRARY_REQUEST_FAILED";
    const requestStatus = desktopRequestErrorStatus(code);
    return NextResponse.json({ status: "error", error: code }, { status: requestStatus ?? 409 });
  }
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const requiredAccess = input.action === "open" ? "READ" : "WRITE";
    const context = await requireDesktopRequestContext("quotes", requiredAccess);
    const repository = createLibraryRepository(context);

    if (input.action === "open") {
      return NextResponse.json(await repository.open(input.leaseId));
    }
    if (input.action === "save") {
      return NextResponse.json(
        await repository.save({
          leaseId: input.leaseId,
          expectedVersion: input.expectedVersion,
          payload: input.payload,
        }),
      );
    }
    if (input.action === "renew") {
      const lock = await repository.renew(input.leaseId);
      return NextResponse.json({ status: "renewed", lock });
    }

    return NextResponse.json({
      status: "released",
      released: await repository.release(input.leaseId),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "LIBRARY_REQUEST_FAILED";
    const requestStatus = desktopRequestErrorStatus(code);
    return NextResponse.json({ status: "error", error: code }, { status: requestStatus ?? 409 });
  }
}
