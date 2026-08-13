import "server-only";
import type {
  MentorAccess,
  MentorCatalogItem,
  MentorMessage,
  MentorPaymentClaim,
  MentorPaymentMethod,
  MentorSettings,
  MentorStudent,
  MentorThread,
} from "@wavekb/domain";
import { publicSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function listMentorCatalog(): Promise<MentorCatalogItem[]> {
  if (!publicSupabaseConfig().configured) return [];
  const client = await createClient();
  const result = await client.rpc("list_mentor_catalog");
  if (result.error) throw result.error;
  return (result.data ?? []) as MentorCatalogItem[];
}

export async function getMentorDetail(mentorId: string): Promise<MentorCatalogItem | null> {
  if (!isUuid(mentorId) || !publicSupabaseConfig().configured) return null;
  const client = await createClient();
  const result = await client.rpc("get_mentor_detail", { p_mentor_id: mentorId });
  if (result.error) throw result.error;
  return ((result.data ?? [])[0] as MentorCatalogItem | undefined) ?? null;
}

export async function listMyMentorAccess(): Promise<MentorAccess[]> {
  const client = await createClient();
  const result = await client.rpc("list_my_mentor_access");
  if (result.error) throw result.error;
  return (result.data ?? []) as MentorAccess[];
}

export async function listMentorPaymentMethods(mentorId: string): Promise<MentorPaymentMethod[]> {
  if (!isUuid(mentorId)) return [];
  const client = await createClient();
  const result = await client.rpc("list_mentor_payment_methods", { p_mentor_id: mentorId });
  if (result.error) throw result.error;
  return (result.data ?? []) as MentorPaymentMethod[];
}

export async function getMentorThread(threadId: string): Promise<MentorThread | null> {
  if (!isUuid(threadId)) return null;
  const client = await createClient();
  const result = await client.rpc("get_mentor_thread", { p_thread_id: threadId });
  if (result.error) throw result.error;
  return ((result.data ?? [])[0] as MentorThread | undefined) ?? null;
}

export async function listMentorMessages(threadId: string): Promise<MentorMessage[]> {
  if (!isUuid(threadId)) return [];
  const client = await createClient();
  const result = await client.rpc("list_mentor_messages", { p_thread_id: threadId });
  if (result.error) throw result.error;
  return (result.data ?? []) as MentorMessage[];
}

export async function getMyMentorSettings(): Promise<MentorSettings | null> {
  const client = await createClient();
  const result = await client.rpc("get_my_mentor_settings");
  if (result.error) throw result.error;
  const value = Array.isArray(result.data) ? result.data[0] : result.data;
  return (value as MentorSettings | null) ?? null;
}

export async function listMyMentorStudents(): Promise<MentorStudent[]> {
  const client = await createClient();
  const result = await client.rpc("list_my_mentor_students");
  if (result.error) throw result.error;
  return (result.data ?? []) as MentorStudent[];
}

export async function listMyMentorPaymentClaims(): Promise<MentorPaymentClaim[]> {
  const client = await createClient();
  const result = await client.rpc("list_my_mentor_payment_claims");
  if (result.error) throw result.error;
  return (result.data ?? []) as MentorPaymentClaim[];
}
