"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, Flag, PaperPlaneRight } from "@phosphor-icons/react";
import { mentorAccessCanAsk, remainingMentorQuota, validateMentorQuestion, type MentorMessage, type MentorThread as MentorThreadValue } from "@wavekb/domain";
import { Button, Field, FieldMessage, Label, Textarea } from "@wavekb/ui";
import { MentorAvatar } from "@/components/mentor-avatar";
import { createClient } from "@/lib/supabase/client";
import { requestMentorServiceCompletion, respondMentorServiceCompletion, sendMentorMessage } from "@/lib/mentor/client-repository";

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/weekly_question_limit_reached/i.test(message)) return "本周提问额度已经用完，下周一自动恢复。";
  if (/tutoring_access_expired/i.test(message)) return "这项辅导权益已经到期，历史消息仍可查看。";
  if (/tutoring_access_closed|service_transition_invalid/i.test(message)) return "服务状态已经变化，请刷新页面后重试。";
  if (/thread_access_denied|permission|jwt|auth/i.test(message)) return "当前账号不能向这段会话发送消息。";
  return message || "消息没有发送，请稍后重试。";
}

export function MentorThread({ actorId, thread, initialMessages }: { actorId: string; thread: MentorThreadValue; initialMessages: MentorMessage[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [liveMessages, setLiveMessages] = useState<{ threadId: string; actorId: string; messages: MentorMessage[] } | null>(null);
  const [readError, setReadError] = useState("");
  const [readBlocked, setReadBlocked] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [serviceStatus, setServiceStatus] = useState(thread.status);
  const [serviceNote, setServiceNote] = useState("");
  const [servicePending, setServicePending] = useState(false);
  const [serviceMessage, setServiceMessage] = useState("");
  const submitting = useRef(false);
  const isStudent = actorId === thread.student_id;
  const accessActive = mentorAccessCanAsk({ ...thread, status: serviceStatus }, now);
  const remaining = accessActive ? remainingMentorQuota(thread) : 0;
  const studentCanSend = accessActive && remaining > 0;
  const mentorCanSend = ["active", "expired", "completion_requested", "disputed"].includes(serviceStatus);
  const canSend = !readBlocked && (isStudent ? studentCanSend : mentorCanSend);
  const messages = readBlocked ? [] : liveMessages?.threadId === thread.thread_id && liveMessages.actorId === actorId ? liveMessages.messages : initialMessages;

  useEffect(() => {
    let alive = true;
    let busy = false;
    async function refreshMessages() {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const client = createClient();
        const auth = await client.auth.getUser();
        if (!alive) return;
        if (auth.error || auth.data.user?.id !== actorId) {
          setReadBlocked(true);
          throw new Error("authentication_required");
        }
        const result = await client.rpc("list_mentor_messages", { p_thread_id: thread.thread_id });
        if (!alive) return;
        if (result.error) {
          if (/thread_access_denied|permission|jwt|auth/i.test(result.error.message)) setReadBlocked(true);
          throw result.error;
        }
        setLiveMessages({ threadId: thread.thread_id, actorId, messages: (result.data ?? []) as MentorMessage[] });
        setReadBlocked(false);
        setReadError("");
        setNow(Date.now());
      } catch {
        if (alive) setReadError("消息暂未同步，请检查登录状态或重试。历史消息未被删除。");
      } finally { busy = false; }
    }
    void refreshMessages();
    const poll = () => { if (alive) { setNow(Date.now()); void refreshMessages(); } };
    const timer = window.setInterval(poll, 10000);
    document.addEventListener("visibilitychange", poll);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [actorId, thread.thread_id, refreshVersion]);

  async function updateService(confirm?: boolean) {
    if (servicePending) return;
    setServicePending(true); setServiceMessage(""); setError("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      if (typeof confirm === "boolean") {
        const result = await respondMentorServiceCompletion(client, thread.thread_id, confirm, serviceNote);
        setServiceStatus(result.status);
        setServiceMessage(confirm ? "服务已确认完成，会话已转为只读。" : "已提出异议，导师仍可回复，等待后台处理。");
      } else {
        const result = await requestMentorServiceCompletion(client, thread.thread_id, serviceNote);
        setServiceStatus(result.status);
        setServiceMessage("结束申请已发送，等待学员确认或提出异议。");
      }
      setServiceNote("");
      router.refresh();
    } catch (serviceError) {
      setError(friendlyError(serviceError));
    } finally { setServicePending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend || submitting.current) return;
    const validation = validateMentorQuestion(body);
    if (!validation.ok) {
      setError(validation.message || "问题内容无效。");
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      await sendMentorMessage(client, thread.thread_id, validation.value);
      setBody("");
      setRefreshVersion((value) => value + 1);
      router.refresh();
    } catch (sendError) {
      setError(friendlyError(sendError));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Button asChild variant="ghost" className="w-fit"><Link href="/tutoring"><ArrowLeft aria-hidden size={17} />返回我的辅导</Link></Button>
      <header className="flex flex-col gap-5 rounded-xl border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><MentorAvatar name={thread.mentor_name} url={thread.mentor_avatar_url} /><div><span className="text-xs font-semibold text-primary">专属波浪辅导</span><h1 className="mt-1 text-2xl font-semibold">{thread.mentor_name}</h1><p className="mt-1 text-xs text-muted-foreground">权益有效至 {new Date(thread.ends_at).toLocaleDateString("zh-CN")}</p></div></div><div className="grid gap-1 rounded-lg bg-muted px-4 py-3 sm:text-right"><span className="text-xs text-muted-foreground">{serviceStatus === "completion_requested" ? "等待学员确认服务结束" : serviceStatus === "disputed" ? "服务结束存在异议" : serviceStatus === "completed" ? "服务已确认完成" : accessActive ? isStudent ? "本周剩余提问" : "学员本周剩余" : isStudent ? "权益已结束 · 历史会话只读" : mentorCanSend ? "学员权益已结束 · 导师可继续回复" : "服务已关闭 · 历史会话只读"}</span><strong className="text-xl tabular-nums">{accessActive ? `${remaining} / ${thread.weekly_question_limit}` : "当前可用 0 次"}</strong>{!accessActive && isStudent && serviceStatus !== "completion_requested" ? <Link className="text-sm text-primary" href={`/mentors/${thread.mentor_id}`}>查看续订方案</Link> : null}</div></header>

      <section className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5" aria-label="服务结束确认">
        <div><h2 className="font-semibold">服务结束确认</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">付款状态不会因服务结束而改变。导师发起结束申请后，由学员确认；如有异议则交由后台处理。</p></div>
        {serviceStatus === "completion_requested" ? <div className="grid gap-3 rounded-lg bg-muted p-4"><strong className="text-sm">导师已申请结束服务</strong>{thread.completion_request_note ? <p className="text-sm leading-6">说明：{thread.completion_request_note}</p> : null}{isStudent ? <><Field><Label htmlFor="service-response-note">确认说明或异议原因（可选）</Label><Textarea id="service-response-note" value={serviceNote} onChange={(event) => setServiceNote(event.target.value)} rows={3} maxLength={1000} disabled={servicePending} /></Field><div className="flex flex-wrap gap-2"><Button type="button" variant="danger" disabled={servicePending} onClick={() => { if (window.confirm("确认对服务结束提出异议？")) void updateService(false); }}><Flag aria-hidden size={17} />提出异议</Button><Button type="button" disabled={servicePending} onClick={() => { if (window.confirm("确认服务已经完成？确认后会话将转为只读。")) void updateService(true); }}><CheckCircle aria-hidden size={17} />确认服务完成</Button></div></> : <p className="text-sm text-muted-foreground">等待学员确认或提出异议。在确认前导师仍可补充回复。</p>}</div> : null}
        {!isStudent && (serviceStatus === "active" || serviceStatus === "expired") ? <div className="grid gap-3"><Field><Label htmlFor="service-request-note">结束说明（可选）</Label><Textarea id="service-request-note" value={serviceNote} onChange={(event) => setServiceNote(event.target.value)} rows={3} maxLength={1000} disabled={servicePending} placeholder="例如：约定周期已完成，问题已全部回复。" /></Field><Button type="button" variant="secondary" className="w-fit" disabled={servicePending} onClick={() => { if (window.confirm("向学员发起服务结束确认？")) void updateService(); }}>申请结束服务</Button></div> : null}
        {serviceStatus === "completed" ? <p className="text-sm font-medium text-primary">学员或后台已确认服务完成，消息会话保持只读。</p> : null}
        {serviceStatus === "disputed" ? <p className="text-sm font-medium text-destructive">学员已提出异议，后台可查看并处理；导师仍可在会话中补充说明。</p> : null}
        {serviceMessage ? <p role="status" className="text-sm font-medium text-primary">{serviceMessage}</p> : null}
      </section>

      {readError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{readError}<Button type="button" variant="secondary" onClick={() => setRefreshVersion((value) => value + 1)}>重试同步消息</Button></div> : null}
      <section className="grid min-h-80 content-start gap-3 rounded-xl border bg-surface p-4 md:p-6" aria-label="辅导消息">{messages.length ? messages.map((message) => { const mine = message.sender_id === actorId; return <article key={message.id} className={`grid max-w-[88%] gap-1 rounded-xl px-4 py-3 text-sm leading-6 sm:max-w-[72%] ${mine ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}><span className={`text-xs font-semibold ${mine ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{mine ? "我" : message.message_kind === "reply" ? thread.mentor_name : "学员"}</span><p className="whitespace-pre-wrap break-words">{message.body}</p><time dateTime={message.created_at} className={`text-[11px] tabular-nums ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{new Date(message.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>; }) : <div className="grid place-items-center gap-2 py-14 text-center"><h2 className="font-semibold">{!accessActive || readBlocked ? "暂无可显示的历史消息" : "从第一个具体问题开始"}</h2><p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">建议写明品种、周期、主计数、备选计数和失效条件。</p></div>}</section>

      <form className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5" onSubmit={submit}><Field><div className="flex items-end justify-between gap-3"><Label htmlFor="mentor-message">{isStudent ? "发送问题" : "回复学员"}</Label><span className="text-xs tabular-nums text-muted-foreground">{body.length}/5000</span></div><Textarea id="mentor-message" value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={5000} disabled={!canSend || pending} placeholder={!canSend ? !accessActive ? "辅导权益已到期，当前只能查看历史消息。" : "本周提问额度已用完，下周一自动恢复。" : isStudent ? "写下一个具体问题，本次发送会计入本周额度。" : "回复学员的问题，不占用学员提问额度。"} /></Field>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted-foreground">服务端会再次核验参与者身份、权益状态和本周额度。</p><Button type="submit" disabled={!canSend || pending}><PaperPlaneRight aria-hidden size={17} />{pending ? "正在发送" : isStudent ? "发送给导师" : "回复学员"}</Button></div></form>
    </div>
  );
}
