import { NextRequest, NextResponse } from "next/server";
import { getLiveCalls } from "@/server/callLog";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";

/** Polled by the Live AI panel while it is open. Scoped to the requesting
 * browser's session tag — never returns another visitor's entries. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ entries: getLiveCalls(readSessionTag(request)) });
}
