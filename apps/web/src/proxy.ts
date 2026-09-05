import { NextResponse, type NextRequest } from "next/server";
import { isBoardSlug } from "@wavekb/domain";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const boardRoute = /^\/community\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  if (boardRoute) {
    let board = boardRoute[1];
    try { board = decodeURIComponent(board); } catch { /* Invalid encoding is not a board. */ }
    // A dynamic page can commit streaming headers before notFound() runs.
    // Validate this finite public route set before rendering; auth stays intact.
    if (!isBoardSlug(board)) return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
