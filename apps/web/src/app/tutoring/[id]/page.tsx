import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MentorThread } from "@/components/mentor-thread";
import { requireCurrentUser } from "@/lib/auth/dal";
import { getMentorThread, listMentorMessages } from "@/lib/mentor/server-repository";

export const metadata: Metadata = { title: "专属辅导会话" };

export default async function TutoringThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireCurrentUser(`/tutoring/${id}`);
  const [thread, messages] = await Promise.all([getMentorThread(id), listMentorMessages(id)]);
  if (!thread) notFound();
  return <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10"><MentorThread actorId={actor.id} thread={thread} initialMessages={messages} /></main>;
}
