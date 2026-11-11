import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
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
    const contexte = await requireModuleRequestContext("quotes", "READ");
    return NextResponse.json(await createLibraryRepository(contexte).load());
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "LIBRARY_REQUEST_FAILED";
    const requestStatus = desktopRequestErrorStatus(code);
    return NextResponse.json({ status: "error", error: code }, { status: requestStatus ?? 409 });
  }
}

export async function POST(requete: Request) {
  try {
    const saisie = requestSchema.parse(await requete.json());
    const requiredAccess = saisie.action === "open" ? "READ" : "WRITE";
    const contexte = await requireModuleRequestContext("quotes", requiredAccess);
    const repository = createLibraryRepository(contexte);

    if (saisie.action === "open") {
      return NextResponse.json(await repository.open(saisie.leaseId));
    }
    if (saisie.action === "save") {
      return NextResponse.json(
        await repository.save({
          leaseId: saisie.leaseId,
          expectedVersion: saisie.expectedVersion,
          payload: saisie.payload,
        }),
      );
    }
    if (saisie.action === "renew") {
      const lock = await repository.renew(saisie.leaseId);
      return NextResponse.json({ status: "renewed", lock });
    }

    return NextResponse.json({
      status: "released",
      released: await repository.release(saisie.leaseId),
    });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "LIBRARY_REQUEST_FAILED";
    const requestStatus = desktopRequestErrorStatus(code);
    return NextResponse.json({ status: "error", error: code }, { status: requestStatus ?? 409 });
  }
}
