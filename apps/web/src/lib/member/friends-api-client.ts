import type { DirectConversation, FriendshipConnection, MemberProfile, PublicProfile } from "@wavekb/domain";

type FriendActionPayload =
  | { action: "search"; uid: number }
  | { action: "request"; targetId: string }
  | { action: "respond"; friendshipId: string; accept: boolean }
  | { action: "conversation"; targetId: string };

type FriendActionResponse = {
  profile?: MemberProfile | null;
  friendshipId?: string;
  conversationId?: string;
  connections?: FriendshipConnection[];
};

export class FriendsApiError extends Error {
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "FriendsApiError";
    this.status = status;
  }
}

async function decode<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new FriendsApiError(payload?.error || "friendships_unavailable", response.status);
  return payload;
}

export async function readFriends(options?: { desktop?: boolean }) {
  const endpoint = options?.desktop ? "/api/member/friends?desktop=1" : "/api/member/friends";
  const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
  return decode<{ actorId: string; actor?: PublicProfile; connections: FriendshipConnection[]; conversations?: DirectConversation[]; count: number }>(response);
}

export async function runFriendAction(payload: FriendActionPayload) {
  const response = await fetch("/api/member/friends", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return decode<FriendActionResponse>(response);
}
