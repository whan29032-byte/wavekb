import type { NextConfig } from "next";
import readingImages from "./src/lib/knowledge/generated-reading-images.json";


// 私有页面统一用 X-Robots-Tag 禁止收录（不再靠 robots.txt 屏蔽，
// 否则 Google 抓不到页面、读不到 noindex，已收录副本不会被移除）。
const privatePagePaths = [
  "/login",
  "/register",
  "/recover",
  "/account",
  "/account/:path*",
  "/account-restricted",
  "/activate-uid",
  "/admin/:path*",
  "/member/:path*",
  "/messages/:path*",
  "/friends/:path*",
  "/workbench/:path*",
  "/tutoring/:path*",
  "/rewards",
  "/mentor/manage",
  "/community/:slug/new",
  "/community/post/:slug/edit",
];

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@wavekb/domain", "@wavekb/knowledge", "@wavekb/ui"],
  // 生产不生成浏览器 sourcemap：源映射会把未压缩的 TS/TSX 原文随构建产物一起
  // 发布到公网，等于把业务逻辑和注释公开。排错走服务端日志与本地构建，不靠线上 map。
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  deploymentId: process.env.DEPLOYMENT_VERSION,
  // Exact content-addressed files only: no permanent caching of mutable
  // originals, arbitrary uploads, or nonexistent hash-shaped URLs.
  headers: async () => [
    ...new Set(Object.values(readingImages)),
  ].map((source) => ({
    source,
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  })).concat(
    privatePagePaths.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    })),
  ),
};

export default nextConfig;
