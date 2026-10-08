"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowsClockwise, CheckCircle, LinkBreak, Pause, Play, YoutubeLogo } from "@phosphor-icons/react";
import { Button } from "@wavekb/ui";
import { authorizeYoutube, disconnectYoutube, importYoutubeHistory, readYoutubeConnection, setYoutubeSync } from "@/lib/youtube/client";
import { sanitizeYoutubeErrorCode, youtubeErrorMessage, type YoutubeConnectionStatus } from "@/lib/youtube/contracts";

type Props = {
  actorId: string | null;
  initialStatus?: YoutubeConnectionStatus;
  preview?: boolean;
  onAuthorizeNavigate?: (url: string) => void;
};

export function YoutubeConnectionPanel(props: Props) {
  return <YoutubeConnectionState key={props.actorId || "guest"} {...props} />;
}

function YoutubeConnectionState({ actorId, initialStatus, preview = false, onAuthorizeNavigate }: Props) {
  const [snapshot, setSnapshot] = useState<YoutubeConnectionStatus | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(Boolean(actorId && !initialStatus));
  const [pending, setPending] = useState(false);
  const [importHistory, setImportHistory] = useState(true);
  const [autoSync, setAutoSync] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [callbackResult, setCallbackResult] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const connection = snapshot?.connection ?? null;

  async function refresh() {
    if (busy.current || !actorId || preview) return;
    busy.current = true;
    try {
      const next = await readYoutubeConnection();
      if (mounted.current) { setSnapshot(next); setError(""); }
    } catch (cause) {
      if (mounted.current) setError(youtubeErrorMessage(cause instanceof Error ? cause.message : "youtube_request_failed"));
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (!actorId || preview) return () => { mounted.current = false; };
    const initial = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const queryResult = query.get("youtube");
      if (queryResult === "error") setCallbackResult(sanitizeYoutubeErrorCode(query.get("youtube_error")));
      else if (queryResult === "cancelled") setCallbackResult("youtube_oauth_denied");
      if (!initialStatus) void refresh();
    }, 0);
    return () => { mounted.current = false; window.clearTimeout(initial); };
    // The owner-keyed child is remounted when the account changes. State must
    // never transfer to a different signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, initialStatus, preview]);

  useEffect(() => {
    if (!actorId || !connection || preview) return;
    const poll = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
    // Polling reads the latest owner-scoped status; it never starts a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, connection?.id, preview]);

  async function action(kind: "authorize" | "pause" | "resume" | "history" | "disconnect") {
    if (busy.current || pending || loading || preview || !actorId || (!snapshot?.configured && kind !== "disconnect")) return;
    if (kind !== "disconnect" && connection?.status === "revocation_pending") return;
    if (kind === "disconnect" && !window.confirm("确认解绑 YouTube？这会停止同步并移除本连接同步生成的帖子；你手工发布的帖子不会被删除。需要时可重新授权。")) return;
    busy.current = true; setPending(true); setError(""); setNotice(""); setCallbackResult("");
    try {
      if (kind === "authorize") {
        const url = await authorizeYoutube({ importHistory, autoSync });
        if (!mounted.current) return;
        setNotice("即将前往 Google 授权。只有完成授权后才会显示已绑定。");
        (onAuthorizeNavigate ?? ((target: string) => window.location.assign(target)))(url);
      } else if (kind === "disconnect") {
        const result = await disconnectYoutube();
        if (mounted.current) {
          setSnapshot({ configured: snapshot?.configured ?? false, connection: result.remoteRevocationPending && connection
            ? { ...connection, channelId: "", channelTitle: "", syncEnabled: false, status: "revocation_pending", lastErrorCode: "youtube_revocation_pending" } : null }); setAutoSync(false);
          setNotice(result.remoteRevocationPending
            ? `站内已解除，移除了 ${result.removedPosts} 篇同步帖子；Google 授权撤销处理中，可在 Google 安全页检查。手工帖子保持不变。`
            : `已解绑，移除了 ${result.removedPosts} 篇由该连接同步生成的帖子；手工帖子保持不变。`);
        }
        try {
          const latest = await readYoutubeConnection();
          if (mounted.current) setSnapshot(latest);
        } catch {
          if (mounted.current) setError("站内解除已处理，但最新授权状态暂时无法读取。请刷新连接状态；不会自动重新绑定或启动同步。");
        }
      } else {
        const next = kind === "history" ? await importYoutubeHistory() : await setYoutubeSync(kind === "resume");
        if (mounted.current) {
          setSnapshot({ configured: true, connection: next });
          setNotice(kind === "history" ? "历史视频导入已排队，进度会自动更新。" : kind === "pause" ? "已暂停新视频同步；已请求的历史导入仍继续，已有帖子保持不变。解绑可停止全部同步并移除生成的帖子。" : "已恢复新视频同步，新公开视频将由后台检查。" );
        }
      }
    } catch (cause) {
      if (mounted.current) setError(youtubeErrorMessage(cause instanceof Error ? cause.message : "youtube_request_failed"));
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  }

  const disabled = pending || loading || preview || !snapshot?.configured;
  const historyLabel = !connection?.importHistory && connection?.historyStatus === "pending" ? "未请求历史导入" : connection?.historyStatus === "complete" ? "历史导入完成" : connection?.historyStatus === "running" ? "正在导入历史视频" : "历史导入等待处理";
  const consentOptions = <>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" className="mt-1.5 accent-primary" checked={importHistory} disabled={disabled} onChange={(event) => setImportHistory(event.target.checked)} /><span><span className="font-medium">授权后导入已有公开视频</span><span className="block text-muted-foreground">从历史视频开始逐批导入，可以取消勾选，只处理后续新视频。</span></span></label>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" className="mt-1.5 accent-primary" checked={autoSync} disabled={disabled} onChange={(event) => setAutoSync(event.target.checked)} /><span><span className="font-medium">我允许后台持续同步并发布频道的新公开视频</span><span className="block text-muted-foreground">默认关闭，需要你明确勾选；绑定后可随时暂停或解绑。</span></span></label>
  </>;

  return <section className="grid min-w-0 gap-5 rounded-xl border bg-surface p-5 sm:p-6" aria-labelledby="youtube-connection-title" aria-busy={loading || pending}>
    <header className="grid gap-2">
      <h2 id="youtube-connection-title" className="flex items-center gap-2 text-xl font-semibold"><YoutubeLogo size={24} aria-hidden className="shrink-0 text-primary" />YouTube 频道</h2>
      <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">将自己频道的公开视频同步为站内帖子。每位用户只能绑定一个频道；不会上传、修改或删除 YouTube 视频，也不会索要 Google 密码。</p>
    </header>
    {preview ? <p role="note" className="text-sm leading-6 text-muted-foreground">本地界面演示，不代表真实 OAuth 绑定，按钮不会发送请求。</p> : null}
    {!actorId ? <Button asChild variant="secondary" className="min-h-11 w-fit"><Link href="/login?next=%2Fmember%2Fprofile">登录后管理频道</Link></Button> : loading ? <p role="status" className="text-sm text-muted-foreground">正在读取 YouTube 连接状态…</p> : <>
      {snapshot?.configured === false ? <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
        <p className="font-medium">Google 授权尚未配置</p><p className="text-sm leading-6 text-muted-foreground">当前未开放新绑定，不会启动新的历史导入或自动发帖。管理员完成配置后，你仍需亲自在 Google 页面授权；已有连接仍可查看或解除。</p>
        <details className="text-sm leading-6"><summary className="min-h-11 cursor-pointer py-2 font-medium">查看管理员配置清单</summary><ol className="ml-5 list-decimal space-y-2 text-muted-foreground"><li>创建 Google Cloud 应用并启用 YouTube Data API v3。</li><li>设置 OAuth 同意页面、测试用户及 Web 应用客户端。</li><li>设置授权回调 <code className="break-all">https://wavekb.com/api/youtube/callback</code>，仅请求 YouTube 只读权限。</li><li>在服务器安全配置客户端凭据、加密密钥并启用服务；凭据不能放入本表单。</li></ol></details>
      </div> : null}
      {connection ? <>
        <div className="grid min-w-0 gap-2 rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="flex min-w-0 items-start gap-2 font-semibold"><CheckCircle size={20} aria-hidden className="mt-0.5 shrink-0 text-primary" /><span className="break-words">{connection.channelTitle.trim() || "YouTube 连接"}</span></h3><span className="text-sm font-medium">{connection.status === "connected" ? "已通过 Google 授权" : connection.status === "revocation_pending" ? "Google 授权撤销处理中" : "需要重新授权"}</span></div>{connection.channelId ? <a className="w-fit break-all text-sm text-primary underline-offset-4 hover:underline" href={`https://www.youtube.com/channel/${connection.channelId}`} target="_blank" rel="noopener noreferrer">查看频道</a> : null}</div>
        <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">新视频自动同步</dt><dd className="mt-1 font-medium">{connection.syncEnabled && connection.status === "connected" ? "已启用" : "已暂停"}</dd></div><div><dt className="text-muted-foreground">历史导入进度</dt><dd className="mt-1 font-medium">{historyLabel} · 累计导入 <span className="tabular-nums">{connection.historyImported}</span> 条</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">最近同步</dt><dd className="mt-1">{connection.lastSyncedAt ? <time dateTime={connection.lastSyncedAt}>{new Date(connection.lastSyncedAt).toLocaleString("zh-CN")}</time> : "尚未完成首次同步"}</dd></div></dl>
        {connection.lastErrorCode ? <p role="alert" className="text-sm leading-6 text-destructive">{youtubeErrorMessage(connection.lastErrorCode)}</p> : null}
        {connection.status === "revocation_pending" || connection.lastErrorCode === "youtube_manual_revocation_required" ? <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="flex min-h-11 w-fit items-center text-sm font-medium text-primary underline-offset-4 hover:underline">在 Google 安全页检查授权</a> : connection.status === "reconnect_required" ? <div className="grid gap-4">{consentOptions}<Button type="button" className="min-h-11 w-full sm:w-fit" disabled={disabled} onClick={() => void action("authorize")}>重新通过 Google 授权</Button></div> : <><div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" className="min-h-11 w-full sm:w-fit" disabled={disabled} onClick={() => void action(connection.syncEnabled ? "pause" : "resume")}>{connection.syncEnabled ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}{connection.syncEnabled ? "暂停新视频同步" : "恢复新视频同步"}</Button><Button type="button" variant="secondary" className="min-h-11 w-full sm:w-fit" disabled={disabled || connection.importHistory && connection.historyStatus !== "complete"} onClick={() => void action("history")}><ArrowsClockwise size={18} aria-hidden />补导历史视频</Button></div><p className="text-sm leading-6 text-muted-foreground">暂停只停止新视频自动发布，已请求的历史导入仍继续；解绑可停止全部同步并移除生成的帖子。</p></>}
        <div className="border-t pt-4"><Button type="button" variant="ghost" className="min-h-11 w-full text-destructive sm:w-fit" disabled={pending || loading || preview} onClick={() => void action("disconnect")}><LinkBreak size={18} aria-hidden />{connection.status === "revocation_pending" ? "重试撤销 Google 授权" : "解绑并移除同步帖子"}</Button><p className="mt-2 text-sm leading-6 text-muted-foreground">解绑只移除这项连接生成的帖子，不影响你手工发布的内容。</p></div>
      </> : <div className="grid gap-4">
        {consentOptions}
        <Button type="button" className="min-h-11 w-full sm:w-fit" disabled={disabled} onClick={() => void action("authorize")}>{pending ? "正在准备 Google 授权…" : "通过 Google 只读授权绑定"}</Button>
      </div>}
      {!preview ? <Button type="button" variant="ghost" className="min-h-11 w-full sm:w-fit" disabled={pending} onClick={() => void refresh()}><ArrowsClockwise size={18} aria-hidden />刷新连接状态</Button> : null}
    </>}
    {pending ? <p role="status" className="text-sm text-muted-foreground">正在处理，请稍候…</p> : null}
    {notice ? <p role="status" className="text-sm leading-6 text-muted-foreground">{notice}</p> : null}
    {callbackResult ? <p role={callbackResult === "youtube_oauth_denied" ? "status" : "alert"} className="text-sm leading-6 text-muted-foreground">{youtubeErrorMessage(callbackResult)}</p> : null}
    {error ? <p role="alert" className="text-sm leading-6 text-destructive">{error}</p> : null}
  </section>;
}
