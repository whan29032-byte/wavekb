import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/site-header";
import { SocialDesktop } from "@/components/social-desktop";
import { PwaRegistration } from "@/components/pwa-registration";
import "./globals.css";
import { APPEARANCE_BOOTSTRAP } from "@/lib/appearance-bootstrap";
import { serializeJsonLd, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: { default: "WaveKB 波浪理论知识库", template: "%s | WaveKB" },
  description: "WaveKB 是面向中文读者的波浪理论与艾略特波浪理论知识库和研究社区。",
  applicationName: "WaveKB",
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "WaveKB", locale: "zh_CN", title: "WaveKB 波浪理论知识库", description: "系统学习波浪理论与艾略特波浪理论，查阅规则、证据与失效边界。" },
  twitter: { card: "summary_large_image", title: "WaveKB 波浪理论知识库", description: "系统学习波浪理论与艾略特波浪理论。" },
  appleWebApp: { capable: true, title: "WaveKB", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#111923" },
  ],
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": "https://wavekb.com/#website", name: "WaveKB", url: "https://wavekb.com/", inLanguage: "zh-CN", description: "波浪理论与艾略特波浪理论知识库和研究社区。" },
    { "@type": "CollectionPage", "@id": "https://wavekb.com/knowledge#collection", name: "WaveKB 波浪理论知识库", url: "https://wavekb.com/knowledge", isPartOf: { "@id": "https://wavekb.com/#website" }, inLanguage: "zh-CN" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      </head>
      <body className="font-sans antialiased">
        <a href="#wavekb-main" className="skip-link">跳到主要内容</a>
        <SiteHeader />
        <div id="wavekb-main">{children}</div>
        <SocialDesktop />
        <PwaRegistration />
      </body>
    </html>
  );
}
