/**
 * Font upload validation. Filenames and client-reported MIME types are
 * untrusted; the file's own magic bytes decide what it is — same principle
 * as `imageValidation.ts`.
 */

export const MAX_FONT_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface DetectedFont {
  mimeType: "font/ttf" | "font/otf" | "font/woff" | "font/woff2";
  extension: "ttf" | "otf" | "woff" | "woff2";
}

export function detectFontType(bytes: Uint8Array): DetectedFont | null {
  if (bytes.length < 4) return null;
  // TrueType: the sfnt version tag is either 0x00010000 or "true" (older
  // Apple TrueType), or "ttcf" for a TrueType Collection.
  const isSfntV1 = bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00;
  const isAppleTrue = bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65;
  const isTtc = bytes[0] === 0x74 && bytes[1] === 0x74 && bytes[2] === 0x63 && bytes[3] === 0x66;
  if (isSfntV1 || isAppleTrue || isTtc) return { mimeType: "font/ttf", extension: "ttf" };
  // OpenType: "OTTO"
  if (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) {
    return { mimeType: "font/otf", extension: "otf" };
  }
  // WOFF: "wOFF"
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return { mimeType: "font/woff", extension: "woff" };
  }
  // WOFF2: "wOF2"
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) {
    return { mimeType: "font/woff2", extension: "woff2" };
  }
  return null;
}
