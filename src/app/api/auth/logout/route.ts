import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

export async function POST(requete: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", requete.url), 303);
}
