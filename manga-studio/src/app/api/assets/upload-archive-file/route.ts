import { NextRequest, NextResponse } from "next/server";
import { detectImageType, MAX_UPLOAD_BYTES } from "@/storage/imageValidation";
import { detectFontType } from "@/storage/fontValidation";
import { putObject } from "@/storage/objectStore";

export const runtime = "nodejs";

/**
 * Re-store one file exactly as it was bundled inside a full-backup archive
 * (`export/projectBackup.ts`) — no processing at all: no background
 * removal, no dimension pipeline. The bytes inside a backup are already-
 * finished derivatives (a processed transparent PNG, a font file); re-
 * running generation-time processing on them would be both wasteful and
 * wrong. Same reasoning as `assets/upload-font/route.ts` not reusing the
 * general `assets/upload` pipeline, generalized to cover both images and
 * fonts here since a full backup can contain either.
 *
 * Same untrusted-input discipline as every other upload route in this
 * codebase: the file's own magic bytes decide its type, never a filename
 * or client-claimed MIME type. Tries image formats first (the overwhelming
 * majority of bundled files), then font formats, and rejects anything else
 * — a backup archive is user-supplied input like any other upload.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Bundled file is too large to restore." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImageType(bytes);
  const font = image ? null : detectFontType(bytes);
  const detected = image ?? font;
  if (!detected) {
    return NextResponse.json({ error: "Unrecognized file inside the backup archive." }, { status: 415 });
  }

  try {
    const stored = await putObject(
      `restored/${crypto.randomUUID()}.${detected.extension}`,
      Buffer.from(bytes),
      detected.mimeType,
    );
    return NextResponse.json({ url: stored.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
