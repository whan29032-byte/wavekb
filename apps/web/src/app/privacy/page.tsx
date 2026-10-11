import type { Metadata } from "next";
import Link from "next/link";
import { SitePolicyPage, policyLinkClass } from "@/components/site-policy-page";

export const metadata: Metadata = { title: "隐私政策", description: "WaveKB 网站账号、内容与 YouTube 只读同步的数据使用、保留、解除授权及删除说明。", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return <SitePolicyPage title="隐私政策" summary="本政策说明 WaveKB 网站（https://wavekb.com，以下简称“本站”）处理数据的用途，以及你可以如何查看、停止同步或申请删除。YouTube 绑定是可选功能，不是注册或阅读公开书籍的条件。">
    <section id="contact"><h2>网站与联系渠道</h2><p>本站公开名称为 WaveKB。隐私、数据删除和账号问题请联系 <a className={policyLinkClass} href="mailto:whan29032@gmail.com">whan29032@gmail.com</a>，并说明需要处理的站内账号及请求。请勿发送密码、验证码、API 密钥、钱包私钥或助记词；处理涉及账号的数据请求前，本站会核验请求者身份。</p></section>
    <section id="account"><h2>账号、内容与功能记录</h2><p>本站按你使用的功能处理登录账号、邮箱和公开个人资料、发布内容、服务订单、会员状态及分析用量记录，用于账号验证、展示内容、处理服务和执行权限。公开资料与公开帖子可能被其他访客查看，请不要在公开内容中上传敏感信息。</p><p>登录会话和界面偏好会使用必要的 Cookie 或本地存储。退出登录不会自动删除已发布的公开帖子。申请处理账号、订单或其他站内数据时，可通过上方邮箱联系；YouTube 连接另有下方可直接操作的解除入口。</p></section>
    <section id="youtube"><h2>YouTube：读取哪些数据、用于什么</h2><p>本功能使用 YouTube API Services，仅在你主动开始绑定并通过 Google 只读授权后，核验你拥有的频道。读取范围为频道 ID、频道名称、上传列表，以及视频 ID、标题、说明、发布时间、公开状态和可嵌入状态。即使只读授权允许查询更多内容，本同步功能只处理符合公开状态的本人频道视频；私有和不公开列出的视频不导入。</p><p>授权过程中产生的短期访问凭据用于请求 Google API；供后台续期使用的 refresh token 在服务端加密保存，并绑定对应站内账号与频道，浏览器不会收到该凭据。本站记录你接受的功能政策版本、服务端接受时间和同步选择，以核对授权用途。</p><p>本同步功能不上传、修改或删除 YouTube 上的视频，不下载、缓存或重新上传视频文件，不把读取的 YouTube API 数据送入 AI 服务、用于模型训练或广告画像，也不出售这些数据。</p></section>
    <section id="sharing"><h2>同步选择与公开发帖</h2><p>历史导入和后续新视频同步分别选择。选择历史导入后，全部符合条件的历史公开视频将分批以你的站内账号发布到“观点分享”；选择后续自动同步后，后台定期检查新公开视频并生成帖子。两项都不选择时，不会自动发布视频帖子。</p><p>生成的公开帖子包含视频标题、说明、播放链接及来源信息，其他访客可以查看。帖子提供 YouTube 播放链接；嵌入播放器是否可播放由 YouTube 设置决定，无法播放时可前往原视频。原始视频仍由 YouTube 提供，本站不会把视频文件复制到自己的服务器。</p><p>读取频道所需的授权数据用于核验和同步；未经你选择公开发布的频道资料或凭据不会向其他用户开放。同步选择不会改变原视频的可见性设置。</p></section>
    <section id="retention"><h2>保留、刷新与删除</h2><p>已同步视频的元数据会分批复核。视频变为私有、不公开列出或已删除时，对应生成帖子会在确认后移除；临时网络失败不会被当作视频已删除。超过 30 天没有成功刷新的视频元数据会停止公开读取并由清理任务移除，任务执行时间受服务运行和队列影响。</p><p>你在站内删除同步帖后，本站会保留不含视频标题、说明和原始视频 ID 的最小去重摘要，防止后台再次生成同一帖子。普通手工帖子不属于这项自动清理范围。</p></section>
    <section id="disconnect"><h2>暂停、解绑与撤销 Google 授权</h2><p>在个人资料的 YouTube 区域，可以暂停新视频同步；暂停不取消已单独请求的历史导入。选择“解绑并移除同步帖子”会停止全部同步、移除该连接生成的帖子和频道元数据、删除连接凭据，保留最小连接及删除意图摘要，避免内容重新生成。手工发布的帖子不受影响。</p><p>本站会将 Google 授权撤销提交到后台处理。为完成撤销重试，仅在独立撤销队列中保留加密凭据，重试窗口最多 7 天，过期后由清理任务删除；任务执行时间受服务运行和队列影响。不能完成时页面会提示你手工撤销。因此站内解绑完成不代表 Google 已回执撤销成功。</p><p>你也可以随时前往 <a className={policyLinkClass} href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google 第三方连接／安全设置</a> 移除 WaveKB 授权。在 Google 撤销后，本功能发现授权不能续期时会停止同步并清理相关数据；已有 API 数据也受上方最长 30 天未刷新的停止展示与清理限制。需要协助或提出删除请求，可联系本站邮箱。</p><p><Link className={policyLinkClass} href="/member/profile">前往个人资料管理频道</Link></p></section>
    <section id="third-parties"><h2>Google、YouTube 与外部服务</h2><p>Google 接收 OAuth 授权请求及本功能的 API 请求，YouTube 提供视频播放和外部链接。打开 Google 授权页、YouTube 链接或使用嵌入播放器时，对应第三方可能接收 IP、设备信息并使用 Cookie 等技术；其处理规则由第三方政策说明。</p><p>请参阅 <a className={policyLinkClass} href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google 隐私政策</a>、<a className={policyLinkClass} href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube 服务条款</a>及 <Link className={policyLinkClass} href="/terms">WaveKB 服务条款</Link>。其他功能实际使用的账号、数据托管或你主动调用的模型服务，会按功能请求处理必要数据；不要通过分析或公开发帖提交不必要的个人秘密。</p></section>
    <section id="changes"><h2>政策与用途变化</h2><p>本站会在本页标注版本与更新日期。YouTube 功能若增加读取类型、改变数据用途或扩大公开发布范围，会先更新说明并要求重新确认，不以旧的同意替代新用途授权。</p></section>
  </SitePolicyPage>;
}
