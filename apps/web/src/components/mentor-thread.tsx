"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PaperPlaneRight } from "@phosphor-icons/react";
import { remainingMentorQuota, validateMentorQuestion, type MentorMessage, type MentorThread as MentorThreadValue } from "@wavekb/domain";
import { Button, Field, FieldMessage, Label, Textarea } from "@wavekb/ui";
import { MentorAvatar } from "@/components/mentor-avatar";
import { createClient } from "@/lib/supabase/client";
import { sendMentorMessage } from "@/lib/mentor/client-repository";

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/weekly_question_limit_reached/i.test(message)) return "本周提问额度已经用完，下周一自动恢复。";
  if (/tutoring_access_expired/i.test(message)) return "这项辅导权益已经到期，历史消息仍可查看。";
  if (/thread_access_denied|permission|jwt|auth/i.test(message)) return "当前账号不能向这段会话发送消息。";
  return message || "消息没有发送，请稍后重试。";
}

export function MentorThread({ actorId, thread, initialMessages }: { actorId: string; thread: MentorThreadValue; initialMessages: MentorMessage[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const isStudent = actorId === thread.student_id;
  const remaining = remainingMentorQuota(thread);
  const studentCanSend = thread.status === "active" && remaining > 0;
  const canSend = isStudent ? studentCanSend : true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateMentorQuestion(body);
    if (!validation.ok) {
      setError(validation.message || "问题内容无效。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      await sendMentorMessage(client, thread.thread_id, validation.value);
      setBody("");
      router.refresh();
    } catch (sendError) {
      setError(friendlyError(sendError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Button asChild variant="ghost" className="w-fit"><Link href="/tutoring"><ArrowLeft aria-hidden size={17} />返回我的辅导</Link></Button>
      <header className="flex flex-col gap-5 rounded-xl border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><MentorAvatar name={thread.mentor_name} url={thread.mentor_avatar_url} /><div><span className="text-xs font-semibold text-primary">专属波浪辅导</span><h1 className="mt-1 text-2xl font-semibold">{thread.mentor_name}</h1><p className="mt-1 text-xs text-muted-foreground">权益有效至 {new Date(thread.ends_at).toLocaleDateString("zh-CN")}</p></div></div><div className="grid gap-1 rounded-lg bg-muted px-4 py-3 sm:text-right"><span className="text-xs text-muted-foreground">{isStudent ? "本周剩余提问" : "学员本周剩余"}</span><strong className="text-xl tabular-nums">{remaining} / {thread.weekly_question_limit}</strong></div></header>

      <section className="grid min-h-80 content-start gap-3 rounded-xl border bg-surface p-4 md:p-6" aria-label="辅导消息">{initialMessages.length ? initialMessages.map((message) => { const mine = message.sender_id === actorId; return <article key={message.id} className={`grid max-w-[88%] gap-1 rounded-xl px-4 py-3 text-sm leading-6 sm:max-w-[72%] ${mine ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}><span className={`text-xs font-semibold ${mine ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{mine ? "我" : message.message_kind === "reply" ? thread.mentor_name : "学员"}</span><p className="whitespace-pre-wrap break-words">{message.body}</p><time dateTime={message.created_at} className={`text-[11px] tabular-nums ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{new Date(message.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>; }) : <div className="grid place-items-center gap-2 py-14 text-center"><h2 className="font-semibold">从第一个具体问题开始</h2><p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">建议写明品种、周期、主计数、备选计数和失效条件。</p></div>}</section>

      <form className="grid gap-4 rounded-xl border bg-surface p-4 md:p-5" onSubmit={submit}><Field><div className="flex items-end justify-between gap-3"><Label htmlFor="mentor-message">{isStudent ? "发送问题" : "回复学员"}</Label><span className="text-xs tabular-nums text-muted-foreground">{body.length}/5000</span></div><Textarea id="mentor-message" value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={5000} disabled={!canSend || pending} placeholder={!canSend ? thread.status !== "active" ? "辅导权益已到期，当前只能查看历史消息。" : "本周提问额度已用完，下周一自动恢复。" : isStudent ? "写下一个具体问题，本次发送会计入本周额度。" : "回复学员的问题，不占用学员提问额度。"} /></Field>{error ? <FieldMessage role="alert">{error}</FieldMessage> : null}<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted-foreground">服务端会再次核验参与者身份、权益状态和本周额度。</p><Button type="submit" disabled={!canSend || pending}><PaperPlaneRight aria-hidden size={17} />{pending ? "正在发送" : isStudent ? "发送给导师" : "回复学员"}</Button></div></form>
    </div>
  );
}
