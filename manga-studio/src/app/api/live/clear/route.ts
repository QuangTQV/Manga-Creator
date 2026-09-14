import { NextRequest, NextResponse } from "next/server";
import { clearLiveCalls } from "@/server/callLog";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  clearLiveCalls(readSessionTag(request));
  return NextResponse.json({ ok: true });
}
