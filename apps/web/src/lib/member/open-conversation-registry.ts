const openConversationCounts = new Map<string, number>();

export function registerOpenConversation(conversationId: string) {
  openConversationCounts.set(conversationId, (openConversationCounts.get(conversationId) ?? 0) + 1);
  return () => {
    const remaining = (openConversationCounts.get(conversationId) ?? 1) - 1;
    if (remaining > 0) openConversationCounts.set(conversationId, remaining);
    else openConversationCounts.delete(conversationId);
  };
}

export function isConversationOpen(conversationId: string) {
  return openConversationCounts.has(conversationId);
}
