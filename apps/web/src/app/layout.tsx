import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SocialDesktop } from "@/components/social-desktop";
import { PwaRegistration } from "@/components/pwa-registration";
import "./globals.css";
import { APPEARANCE_BOOTSTRAP } from "@/lib/appearance-bootstrap";
import { PWA_BOOTSTRAP } from "@/lib/pwa-bootstrap";
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
  viewportFit: "cover",
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
        {/* Register independently of stylesheet-blocked classic scripts. The
            appearance bootstrap still runs before any page content paints. */}
        <script id="wavekb-pwa-bootstrap" type="module" async dangerouslySetInnerHTML={{ __html: PWA_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      </head>
      <body className="font-sans antialiased">
        <a href="#wavekb-main" className="skip-link">跳到主要内容</a>
        <SiteHeader />
        <div id="wavekb-main">{children}</div>
        <footer className="border-t border-border bg-surface-subtle/55">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="grid gap-2">
              <Link href="/" className="flex w-fit items-center gap-2 font-semibold tracking-tight">
                <span className="grid size-7 place-items-center rounded-[var(--radius-control)] bg-primary text-xs font-bold text-primary-foreground">W</span>
                <span>WaveKB</span>
              </Link>
              <p className="max-w-[58ch] text-sm leading-6 text-muted-foreground">艾略特波浪理论中文知识库与研究社区。知识、规则、证据与讨论保持同一套上下文。</p>
            </div>
            <nav aria-label="网站数据与服务说明" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <Link prefetch={false} className="flex min-h-11 items-center font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline" href="/privacy">隐私政策</Link>
              <Link prefetch={false} className="flex min-h-11 items-center font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline" href="/terms">服务条款</Link>
              <a className="flex min-h-11 items-center break-all font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline" href="mailto:whan29032@gmail.com">联系网站</a>
            </nav>
          </div>
          <div className="border-t border-border-subtle">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground md:px-6">
              <span>© {new Date().getFullYear()} WaveKB</span>
              <span>知识内容仅供研究与学习，不构成投资建议。</span>
            </div>
          </div>
        </footer>
        <SocialDesktop />
        <PwaRegistration />
      </body>
    </html>
  );
}
