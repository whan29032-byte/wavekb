import { notFound } from "next/navigation";
import { MessageThread } from "@/components/message-thread";
import { requireActiveMember } from "@/lib/auth/dal";
import { listChatStickers, listConversations, listDirectMessages } from "@/lib/member/server-repository";

type PageProps = { params: Promise<{ id: string }> };

export default async function MessagePage({ params }: PageProps) {
  const { id } = await params;
  const actor = await requireActiveMember(`/messages/${id}`);
  const conversations = await listConversations();
  const conversation = conversations.find((item) => item.conversation_id === id);
  if (!conversation) notFound();
  const [messages, stickers] = await Promise.all([listDirectMessages(id), listChatStickers(actor.id).catch(() => [])]);
  return <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10"><MessageThread actorId={actor.id} conversation={conversation} initialMessages={messages} initialCustomStickers={stickers} /></main>;
}
