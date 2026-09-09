import type { Metadata } from "next";
import { BOARDS, isBoardSlug } from "@wavekb/domain";
import { publicMetadata } from "@/lib/seo";

const pages = {
  research: { title: "机构研报", description: "在 WaveKB 阅读已同步保存的近期机构研报与研究摘要。", path: "/research" },
  mentors: { title: "导师辅导", description: "查看 WaveKB 平台导师、透明方案和专属辅导权益。", path: "/mentors" },
  leaderboard: { title: "交易收益排行榜", description: "按币安 U 本位合约只读账户绑定以来的最新时间加权收益率排序。", path: "/leaderboard" },
} as const;

export function publicPageMetadata(key: keyof typeof pages | "community", slug?: string): Metadata {
  if (key === "community") {
    if (!slug || !isBoardSlug(slug)) return {};
    return publicMetadata({ title: BOARDS[slug].title, description: BOARDS[slug].description, path: `/community/${slug}` });
  }
  return publicMetadata(pages[key]);
}
