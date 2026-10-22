import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSession } from "./lib/auth";

export async function middleware(req: NextRequest) {
  if (await validSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|manifest.webmanifest|icon.svg|sw.js|favicon.ico).*)"],
};
