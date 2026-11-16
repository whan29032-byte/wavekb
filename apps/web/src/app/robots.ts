import type { MetadataRoute } from "next";

/**
 * 只屏蔽 API 与后台接口本身。
 *
 * 私有页面（登录、注册、账户、消息等）不再写进 robots.txt：
 * 页面被 robots 屏蔽时 Google 无法读到页面上的 noindex，已经收录的副本
 * 就会永久停在「已编入索引，尽管遭到 robots.txt 屏蔽」。
 * 这些路径统一由 next.config.ts 下发 X-Robots-Tag: noindex，允许抓取、禁止收录。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: "https://wavekb.com/sitemap.xml",
    host: "https://wavekb.com",
  };
}
