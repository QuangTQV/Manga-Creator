import { NextRequest, NextResponse } from "next/server";
import { detectFontType, MAX_FONT_UPLOAD_BYTES } from "@/storage/fontValidation";
import { putObject } from "@/storage/objectStore";

export const runtime = "nodejs";

/**
 * Upload a lettering font. Deliberately separate from `assets/upload` — a
 * font file isn't an image, needs none of that route's dimension reading
 * or AI processing pipeline (background removal, transparency cascade),
 * and mixing the two would mean threading "this upload might not be an
 * image at all" through code that assumes it always is. Same underlying
 * object storage (`putObject`), same untrusted-input discipline: the
 * file's own magic bytes decide its type, never a filename or client-
 * claimed MIME type.
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
  if (file.size > MAX_FONT_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Font file is too large. Maximum size: 5 MB." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFontType(bytes);
  if (!detected) {
    return NextResponse.json({ error: "Unsupported font format. Use TTF, OTF, WOFF, or WOFF2." }, { status: 415 });
  }

  try {
    const stored = await putObject(`fonts/${crypto.randomUUID()}.${detected.extension}`, Buffer.from(bytes), detected.mimeType);
    return NextResponse.json({ url: stored.url, format: detected.extension });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
