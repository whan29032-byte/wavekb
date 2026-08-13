import "server-only";
import type { PrivateEntry, PrivateEntryImage, PrivateEntryKind, WorkbenchAnalysis } from "@wavekb/domain";
import { createClient } from "@/lib/supabase/server";

const ENTRY_SELECT = "id,owner_id,kind,title,body,instrument,market,timeframe,tags,knowledge_ids,workbench_analysis_id,review_data,created_at,updated_at,deleted_at";

type EntryRow = Omit<PrivateEntry, "private_entry_images">;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function listPrivateEntries(ownerId: string, kind?: PrivateEntryKind): Promise<PrivateEntry[]> {
  const client = await createClient();
  let query = client.from("private_entries").select(ENTRY_SELECT)
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (kind) query = query.eq("kind", kind);
  const result = await query;
  if (result.error) throw result.error;
  return ((result.data ?? []) as EntryRow[]).map((entry) => ({ ...entry, private_entry_images: [] }));
}

export async function getPrivateEntry(id: string, ownerId: string): Promise<PrivateEntry | null> {
  if (!isUuid(id)) return null;
  const client = await createClient();
  const result = await client.from("private_entries").select(ENTRY_SELECT)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;

  const imageResult = await client.from("private_entry_images")
    .select("id,entry_id,owner_id,storage_path,sort_order,created_at")
    .eq("entry_id", id)
    .eq("owner_id", ownerId)
    .order("sort_order", { ascending: true });
  if (imageResult.error) throw imageResult.error;
  const images = await Promise.all(((imageResult.data ?? []) as PrivateEntryImage[]).map(async (image) => {
    const signed = await client.storage.from("private-entry-images").createSignedUrl(image.storage_path, 3600);
    if (signed.error) throw signed.error;
    return { ...image, signed_url: signed.data.signedUrl };
  }));
  return { ...(result.data as EntryRow), private_entry_images: images };
}

export async function listWorkbenchAnalyses(ownerId: string): Promise<WorkbenchAnalysis[]> {
  const client = await createClient();
  const result = await client.from("workbench_analyses").select("*").eq("owner_id", ownerId).order("updated_at", { ascending: false }).limit(20);
  if (result.error) throw result.error;
  return (result.data ?? []) as WorkbenchAnalysis[];
}

export async function getWorkbenchAnalysis(id: string, ownerId: string): Promise<WorkbenchAnalysis | null> {
  if (!isUuid(id)) return null;
  const client = await createClient();
  const result = await client.from("workbench_analyses").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle();
  if (result.error) throw result.error;
  return result.data as WorkbenchAnalysis | null;
}
