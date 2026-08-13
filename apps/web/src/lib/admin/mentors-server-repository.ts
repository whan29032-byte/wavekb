import "server-only";
import { requireAdminActor } from "@/lib/admin/auth";
import type { AdminMentor, AdminMentorOffer, AdminMentorOrder, AdminMentorPaymentMethod, AdminMentorStore } from "@/lib/admin/mentors-types";
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
  return {
    mentors: ((catalog.data ?? []) as Array<Record<string, unknown>>).map((item) => ({ ...item, sort_order: Number(item.sort_order || 0), specialties: parseArray<string>(item.specialties), credentials: parseArray<string>(item.credentials), languages: parseArray<string>(item.languages), mentor_offers: parseArray<AdminMentorOffer>(item.mentor_offers).map((offer) => ({ ...offer, price_cents: Number(offer.price_cents || 0), duration_days: Number(offer.duration_days || 0), weekly_questions: Number(offer.weekly_questions || 0), sort_order: Number(offer.sort_order || 0) })), payment_methods: parseArray<AdminMentorPaymentMethod>(item.payment_methods) })) as AdminMentor[],
    orders: ((orders.data ?? []) as AdminMentorOrder[]).map((item) => ({ ...item, amount_cents: Number(item.amount_cents || 0) })),
  };
}
