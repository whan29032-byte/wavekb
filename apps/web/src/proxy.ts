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
    if (!isBoardSlug(board)) {
      // Do not rewrite to a loopback URL: HTTPS termination + Next's localhost
      // normalization can turn an internal rewrite into an HTTPS self-proxy.
      // Static markup never interpolates the untrusted path or session data.
      return new NextResponse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>板块不存在 | WaveKB</title><style>:root{color-scheme:light dark}body{margin:0;font:16px/1.6 system-ui,sans-serif}main{max-width:40rem;margin:15vh auto;padding:1.5rem}h1{font-size:1.5rem}a{color:inherit;text-underline-offset:.25em}</style></head><body><main><p>WaveKB · 404</p><h1>找不到这个社区板块</h1><p>请从已有社区板块继续浏览。</p><a href="/community/idea_sharing">返回社区</a></main></body></html>`, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
