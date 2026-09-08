import type { MetadataRoute } from "next";
import { BOARD_SLUGS } from "@wavekb/domain";
import { knowledgeData } from "@wavekb/knowledge";
import { getKnowledgeBookCatalog } from "@/lib/knowledge/book-catalog";

const origin = "https://wavekb.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const data = knowledgeData();
  const publicRoots = ["/", "/knowledge", "/knowledge/books", "/research", "/leaderboard", "/mentors"];
  const knowledgeRoutes = [
    ...data.pages.map((page) => `/knowledge/${page.id}`),
    ...getKnowledgeBookCatalog(data).map((book) => `/knowledge/books/${book.id}`),
    ...data.themes.map((theme) => `/knowledge/themes/${theme.id}`),
    ...data.questions.map((question) => `/knowledge/questions/${question.id}`),
    ...data.chapters.map((chapter) => `/knowledge/chapters/${chapter.id}`),
  ];
  const communityRoots = BOARD_SLUGS.map((board) => `/community/${board}`);

  return [...publicRoots, ...knowledgeRoutes, ...communityRoots].map((path) => ({
    url: new URL(path, `${origin}/`).toString(),
    changeFrequency: path.startsWith("/knowledge") ? "monthly" as const : "weekly" as const,
    priority: path === "/" ? 1 : path === "/knowledge" ? 0.9 : 0.7,
  }));
}
