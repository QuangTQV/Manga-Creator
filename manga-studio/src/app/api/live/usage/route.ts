import { NextRequest, NextResponse } from "next/server";
import { getUsageStats } from "@/server/callLog";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";

/** Since-server-start usage counts for the requesting browser's session —
 * see UsageStats in callLog.ts for why this is call counts, not a cost. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(getUsageStats(readSessionTag(request)));
}
