import type { Metadata } from "next";
import Link from "next/link";
import { SitePolicyPage, policyLinkClass } from "@/components/site-policy-page";

export const metadata: Metadata = { title: "服务条款", description: "WaveKB 网站使用与可选 YouTube 同步功能说明。", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <SitePolicyPage title="服务条款" summary="本页说明 WaveKB 网站的使用范围和可选 YouTube 同步规则。请结合隐私政策和每项功能的实际操作说明阅读。">
    <section><h2>账号与内容</h2><p>请使用自己有权管理的账号和频道，不冒充他人，不分享账号凭据，不绕过网站的账号验证或权限限制。你发布的内容应具有相应权利，不侵犯他人隐私或版权，不发布恶意、欺诈或违法内容。</p><p>公开书籍阅读与原有注册入口不因本条款变更而收费。会员权益、价格、支付方式和服务订单以实际页面及提交前说明为准；本页不新增自动续费、扣款或退款规则。</p></section>
    <section id="youtube"><h2>YouTube 可选功能</h2><p>使用本功能时，你需要阅读并同意本站 <Link className={policyLinkClass} href="/privacy#youtube">隐私政策</Link>、本页条款及 <a className={policyLinkClass} href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube 服务条款</a>，并亲自在 Google 页面授予只读权限。仅可绑定经 Google 核验属于你的频道；绑定不意味着历史导入或新视频自动发布必然成功。</p><p>你选择历史导入或新视频同步，即允许按所选范围把本人频道的公开视频标题、说明和播放链接以站内账号公开发布到“观点分享”。本站不上传、修改或删除 YouTube 原视频，不复制视频文件，不支持导入私有或不公开列出的视频。</p><p>后台采用轮询、分页和重试，历史导入可能分多轮完成；网络、Google 配额、授权有效期和服务运行状态会影响速度。本功能不承诺即时同步；进度以真实连接及导入记录为准。</p><p>你可暂停新视频同步或解绑；暂停仍保留已请求的历史导入，解绑移除该连接生成的帖子、不影响手工帖子。Google 撤销可能处于重试中，请根据页面状态及 <a className={policyLinkClass} href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google 第三方连接</a> 核对授权。</p></section>
    <section><h2>研究与分析</h2><p>本站的知识资料、社区讨论和模型分析用于学习与研究，不保证分析正确、策略盈利或未来表现。请核对数据、适用条件与失效边界，不把模型输出当作已经发生的事实或保证收益。</p></section>
    <section><h2>问题与联系</h2><p>服务、版权、隐私或数据删除问题可联系 <a className={policyLinkClass} href="mailto:whan29032@gmail.com">whan29032@gmail.com</a>。请提供必要的站内账号和问题说明，不发送密码、验证码或密钥。需要扩大 YouTube 权限或改变用途时，本站会另行提示并要求重新确认。</p></section>
  </SitePolicyPage>;
}
