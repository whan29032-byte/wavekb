import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SocialDesktop } from "@/components/social-desktop";
import "./globals.css";
import { APPEARANCE_BOOTSTRAP } from "@/lib/appearance-bootstrap";

export const metadata: Metadata = {
  title: { default: "WaveKB", template: "%s | WaveKB" },
  description: "艾略特波浪理论知识库与研究社区。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
      </head>
      <body className="font-sans antialiased">
        <a href="#wavekb-main" className="skip-link">跳到主要内容</a>
        <SiteHeader />
        <div id="wavekb-main">{children}</div>
        <SocialDesktop />
      </body>
    </html>
  );
}
