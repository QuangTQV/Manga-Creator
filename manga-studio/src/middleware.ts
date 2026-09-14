import { NextRequest, NextResponse } from "next/server";
import { SESSION_TAG_COOKIE } from "@/server/sessionTag";

/**
 * Ensures every visitor carries a `SESSION_TAG_COOKIE` before any route
 * handler runs, so `callLog.ts` always has something stable to scope the
 * Live AI panel's entries to — without every route that might log a call
 * having to handle "no tag yet, mint and attach one" itself.
 *
 * Not a secret: it identifies a browser for the Live AI feed only, never
 * decrypts or authorizes anything (BYOK credentials stay in their own
 * separate, encrypted, HttpOnly cookies — see providerSession.ts).
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.get(SESSION_TAG_COOKIE)) return NextResponse.next();
  const response = NextResponse.next();
  response.cookies.set(SESSION_TAG_COOKIE, crypto.randomUUID(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
