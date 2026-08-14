import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SocialDesktop } from "@/components/social-desktop";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WaveKB", template: "%s | WaveKB" },
  description: "艾略特波浪理论知识库与研究社区。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var v=JSON.parse(localStorage.getItem('wavekb:appearance:v1')||'null')||{};var t=['wave','sakura','aurora','star','ink','custom'].includes(v.theme)?v.theme:'wave';var m=['light','dark','system'].includes(v.mode)?v.mode:'system';var c=/^#[0-9a-f]{6}$/i.test(v.customColor||'')?v.customColor:'#557fb8';var a=[1,3,5].map(function(i){return parseInt(c.slice(i,i+2),16)}),l=function(q){var z=q.map(function(x){x=x/255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*z[0]+.7152*z[1]+.0722*z[2]},f=1;while(l(a.map(function(x){return x*f}))>.18&&f>.2)f-=.02;var cr='#'+a.map(function(x){return Math.round(x*f).toString(16).padStart(2,'0')}).join('');var r=document.documentElement;r.dataset.wavekbTheme=t;r.dataset.wavekbMode=m;r.style.setProperty('--wavekb-user-accent',c);r.style.setProperty('--wavekb-user-accent-readable',cr);r.style.setProperty('--wavekb-user-on-accent','#fff')}catch(e){}})();` }} />
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
