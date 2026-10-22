import "server-only";
import { requireAdminActor } from "@/lib/admin/auth";
import type { AdminMentor, AdminMentorOffer, AdminMentorOrder, AdminMentorPaymentMethod, AdminMentorService, AdminMentorStore } from "@/lib/admin/mentors-types";
import { createClient } from "@/lib/supabase/server";

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; } }
  return [];
}

export async function getAdminMentorStore(): Promise<AdminMentorStore> {
  const actor = await requireAdminActor("/admin/mentors");
  if (!actor) throw new Error("admin_required");
  const client = await createClient();
  let catalog = await client.rpc("admin_list_mentor_catalog_v2");
  if (catalog.error && /does not exist|schema cache|PGRST202|42883/i.test(String(catalog.error.message || catalog.error))) catalog = await client.rpc("admin_list_mentor_catalog");
  if (catalog.error) throw catalog.error;
  const orders = await client.from("mentor_orders").select("id,buyer_id,mentor_id,offer_id,amount_cents,currency,status,payment_provider,provider_order_id,paid_at,created_at").order("created_at", { ascending: false }).limit(200);
  if (orders.error) throw orders.error;
  const entitlements = await client.from("mentor_entitlements").select("id,order_id,student_id,mentor_id,status,starts_at,ends_at,completion_requested_at,completion_request_note,completion_responded_at,completion_response_note").order("created_at", { ascending: false }).limit(200);
  if (entitlements.error) throw entitlements.error;
  const entitlementRows = (entitlements.data ?? []) as Array<Record<string, unknown>>;
  const studentIds = [...new Set(entitlementRows.map((item) => String(item.student_id)))];
  const entitlementIds = entitlementRows.map((item) => String(item.id));
  const [students, threads] = await Promise.all([
    studentIds.length ? client.from("profiles").select("id,public_uid,display_name").in("id", studentIds) : Promise.resolve({ data: [], error: null }),
    entitlementIds.length ? client.from("mentor_threads").select("id,entitlement_id").in("entitlement_id", entitlementIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (students.error) throw students.error;
  if (threads.error) throw threads.error;
  const studentMap = new Map(((students.data ?? []) as Array<{ id: string; public_uid: number | null; display_name: string }>).map((item) => [item.id, item]));
  const threadMap = new Map(((threads.data ?? []) as Array<{ id: string; entitlement_id: string }>).map((item) => [item.entitlement_id, item.id]));
  const now = Date.now();
  return {
    mentors: ((catalog.data ?? []) as Array<Record<string, unknown>>).map((item) => ({ ...item, sort_order: Number(item.sort_order || 0), specialties: parseArray<string>(item.specialties), credentials: parseArray<string>(item.credentials), languages: parseArray<string>(item.languages), mentor_offers: parseArray<AdminMentorOffer>(item.mentor_offers).map((offer) => ({ ...offer, price_cents: Number(offer.price_cents || 0), duration_days: Number(offer.duration_days || 0), weekly_questions: Number(offer.weekly_questions || 0), sort_order: Number(offer.sort_order || 0) })), payment_methods: parseArray<AdminMentorPaymentMethod>(item.payment_methods) })) as AdminMentor[],
    orders: ((orders.data ?? []) as AdminMentorOrder[]).map((item) => ({ ...item, amount_cents: Number(item.amount_cents || 0) })),
    services: entitlementRows.map((item) => {
      const stored = String(item.status) as AdminMentorService["stored_status"];
      const student = studentMap.get(String(item.student_id));
      return {
        ...item,
        id: String(item.id), order_id: String(item.order_id), student_id: String(item.student_id), mentor_id: String(item.mentor_id),
        student_name: student?.display_name || `用户 ${String(item.student_id).slice(0, 8)}`,
        student_uid: student?.public_uid ?? null,
        thread_id: threadMap.get(String(item.id)) || null,
        stored_status: stored,
        status: stored === "active" && new Date(String(item.ends_at)).getTime() <= now ? "expired" : stored,
        completion_requested_at: item.completion_requested_at ? String(item.completion_requested_at) : null,
        completion_request_note: String(item.completion_request_note || ""),
        completion_responded_at: item.completion_responded_at ? String(item.completion_responded_at) : null,
        completion_response_note: String(item.completion_response_note || ""),
        starts_at: String(item.starts_at), ends_at: String(item.ends_at),
      } as AdminMentorService;
    }),
  };
}
