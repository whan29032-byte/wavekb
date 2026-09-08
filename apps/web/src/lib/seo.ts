import type { Metadata } from "next";

export const SITE_URL = new URL("https://wavekb.com");

export function publicMetadata({ title, description, path, type = "website" }: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: "WaveKB", locale: "zh_CN", type },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
