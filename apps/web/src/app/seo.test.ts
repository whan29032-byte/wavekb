import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { knowledgeData } from "@wavekb/knowledge";
import { BOARD_SLUGS } from "@wavekb/domain";
import * as rootLayout from "./layout";
import { generateMetadata as generateKnowledgeMetadata, generateStaticParams as knowledgeParams } from "./knowledge/[id]/page";
import { getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";

async function optionalModule<T>(path: string): Promise<T | null> {
  return import(/* @vite-ignore */ path).catch(() => null) as Promise<T | null>;
}

it("publishes an installable WaveKB standalone manifest", async () => {
  const routeModule = await optionalModule<{ default: () => Record<string, unknown> }>("./manifest");
  const manifest = routeModule?.default();

  expect(manifest).toMatchObject({
    name: "WaveKB",
    short_name: "WaveKB",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#3f6f9f",
  });
  expect(manifest?.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    expect.objectContaining({ purpose: "maskable" }),
  ]));
});

it("allows public crawling while keeping private areas out of crawler traversal", async () => {
  const routeModule = await optionalModule<{ default: () => { rules: Array<{ allow?: string; disallow?: string[] }>; sitemap: string } }>("./robots");
  const robots = routeModule?.default();

  expect(robots?.sitemap).toBe("https://wavekb.com/sitemap.xml");
  expect(robots?.rules).toEqual(expect.arrayContaining([
    expect.objectContaining({ allow: "/" }),
    expect.objectContaining({ disallow: expect.arrayContaining(["/api/", "/admin/", "/account/", "/messages/", "/workbench/"]) }),
  ]));
});

it("lists every generated knowledge route and only canonical public URLs", async () => {
  const routeModule = await optionalModule<{ default: () => Array<{ url: string }> }>("./sitemap");
  const sitemap = routeModule?.default() ?? [];
  const urls = sitemap.map((entry) => entry.url);
  const data = knowledgeData();

  expect(urls).toEqual(expect.arrayContaining([
    "https://wavekb.com/",
    "https://wavekb.com/knowledge",
    "https://wavekb.com/knowledge/books",
    ...data.pages.map((page) => `https://wavekb.com/knowledge/${page.id}`),
    ...getKnowledgeBookCatalog(data).map((book) => `https://wavekb.com/knowledge/books/${book.id}`),
    ...data.themes.map((theme) => `https://wavekb.com/knowledge/themes/${theme.id}`),
    ...data.questions.map((question) => `https://wavekb.com/knowledge/questions/${question.id}`),
    ...data.chapters.map((chapter) => `https://wavekb.com/knowledge/chapters/${chapter.id}`),
    ...BOARD_SLUGS.map((board) => `https://wavekb.com/community/${board}`),
  ]));
  expect(urls.every((url) => url.startsWith("https://wavekb.com/") && !url.includes("?"))).toBe(true);
  expect(urls.some((url) => /\/(?:api|admin|account|friends|login|member|messages|profile|register|recover|tutoring|workbench)(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
});

it("exposes Chinese Wave Theory metadata, social cards, Apple settings, and an accessible viewport", () => {
  const { metadata, viewport } = rootLayout as typeof rootLayout & { viewport?: { userScalable?: boolean; maximumScale?: number; themeColor?: unknown } };
  const description = String(metadata.description);

  expect(metadata.metadataBase?.toString()).toBe("https://wavekb.com/");
  expect(description).toContain("波浪理论");
  expect(description).toContain("艾略特波浪理论");
  expect(metadata.alternates).toMatchObject({ canonical: "/" });
  expect(metadata.openGraph).toMatchObject({ type: "website", url: "/", siteName: "WaveKB" });
  expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  expect(metadata.appleWebApp).toMatchObject({ capable: true, title: "WaveKB", statusBarStyle: "default" });
  expect(viewport?.themeColor).toBeTruthy();
  expect(viewport?.userScalable).not.toBe(false);
  expect(viewport?.maximumScale).toBeUndefined();
});

it("publishes canonical metadata for generated knowledge pages", async () => {
  const [{ id }] = knowledgeParams();
  const metadata = await generateKnowledgeMetadata({ params: Promise.resolve({ id }) });

  expect(metadata.alternates).toMatchObject({ canonical: `/knowledge/${id}` });
  expect(metadata.openGraph).toMatchObject({ url: `/knowledge/${id}`, type: "article" });
});

it("does not inherit the home canonical on stable public roots", async () => {
  const board = BOARD_SLUGS[0];
  const routeModule = await optionalModule<{ publicPageMetadata: (key: "research" | "mentors" | "leaderboard" | "community", slug?: string) => { alternates?: unknown } }>("../lib/public-page-metadata");

  expect(routeModule?.publicPageMetadata("research").alternates).toMatchObject({ canonical: "/research" });
  expect(routeModule?.publicPageMetadata("mentors").alternates).toMatchObject({ canonical: "/mentors" });
  expect(routeModule?.publicPageMetadata("leaderboard").alternates).toMatchObject({ canonical: "/leaderboard" });
  expect(routeModule?.publicPageMetadata("community", board).alternates).toMatchObject({ canonical: `/community/${board}` });
});

it("serializes structured data without allowing an HTML script breakout", async () => {
  const routeModule = await optionalModule<{ serializeJsonLd: (value: unknown) => string }>("../lib/seo");

  expect(routeModule?.serializeJsonLd({ name: "</script><script>alert(1)</script>" })).toBe(
    '{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}',
  );
});

it("ships the offline fallback as a static, account-free document", async () => {
  const html = await readFile(join(process.cwd(), "public", "offline.html"), "utf8").catch(() => "");

  expect(html).toContain("WaveKB");
  expect(html).toContain("知识库");
  expect(html).not.toMatch(/账号|登录|用户|会员/);
});
