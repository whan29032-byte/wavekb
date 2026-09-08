import type { MetadataRoute } from "next";

const privateRoutes = [
  "/api/", "/admin/", "/account/", "/account-restricted", "/activate-uid", "/friends/",
  "/login", "/member/", "/messages/", "/mentor/manage", "/recover", "/register",
  "/rewards", "/tutoring/", "/workbench/", "/community/*/new", "/community/post/*/edit",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: privateRoutes }],
    sitemap: "https://wavekb.com/sitemap.xml",
    host: "https://wavekb.com",
  };
}
