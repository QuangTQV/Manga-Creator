import { NextRequest, NextResponse } from "next/server";
import { readLocalObject } from "@/storage/objectStore";
import { detectImageType } from "@/storage/imageValidation";
import { detectFontType } from "@/storage/fontValidation";

export const runtime = "nodejs";

/** Dev-only file server for the local (.data) storage fallback. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path: segments } = await context.params;
  const data = await readLocalObject(segments.join("/"));
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const head = new Uint8Array(data.subarray(0, 16));
  // Images and fonts are the two kinds of binaries this dev fallback ever
  // serves; the browser's FontFace loader is stricter about a correct
  // Content-Type than <img> tends to be, so this must not just fall back
  // to a generic type for an uploaded font.
  const contentType = detectImageType(head)?.mimeType ?? detectFontType(head)?.mimeType ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
