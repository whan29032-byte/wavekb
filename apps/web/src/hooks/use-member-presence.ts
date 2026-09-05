"use client";

import { useEffect, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Listener = (ids: Set<string>) => void;
type Presence = {
  actorId: string;
  listeners: Set<Listener>;
  online: Set<string>;
  channel?: RealtimeChannel;
  disposal?: ReturnType<typeof setTimeout>;
};
type Registry = { current?: Presence; closing: Promise<unknown> };
const registries = new WeakMap<SupabaseClient, Registry>();

function publish(entry: Presence, ids: Set<string>) {
  entry.online = ids;
  entry.listeners.forEach((listener) => listener(ids));
}

function close(client: SupabaseClient, registry: Registry, entry: Presence) {
  if (entry.disposal) clearTimeout(entry.disposal);
  if (registry.current === entry) registry.current = undefined;
  publish(entry, new Set());
  // removeChannel performs unsubscribe/untrack. Serialize it before reusing
  // the topic: Supabase returns the old channel until removal completes.
  if (entry.channel) registry.closing = registry.closing.then(() => client.removeChannel(entry.channel!)).catch(() => undefined);
}

function subscribe(actorId: string, listener: Listener) {
  const client = createClient();
  let registry = registries.get(client);
  if (!registry) { registry = { closing: Promise.resolve() }; registries.set(client, registry); }
  if (registry.current && registry.current.actorId !== actorId) close(client, registry, registry.current);
  let entry = registry.current;
  if (!entry) {
    entry = { actorId, listeners: new Set(), online: new Set() };
    registry.current = entry;
    const current = entry;
    const owner = registry;
    void owner.closing.then(() => {
      if (owner.current !== current || !current.listeners.size) return;
      const channel = client.channel("wavekb-member-presence", { config: { presence: { key: actorId } } });
      current.channel = channel;
      channel.on("presence", { event: "sync" }, () => {
        if (owner.current !== current) return;
        const ids = new Set<string>();
        Object.entries(channel.presenceState()).forEach(([key, entries]) => {
          ids.add(key);
          entries.forEach((entry) => { const id = (entry as { user_id?: string }).user_id; if (id) ids.add(id); });
        });
        publish(current, ids);
      }).subscribe((status) => {
        if (owner.current !== current) return;
        if (status === "SUBSCRIBED") {
          void channel.track({ user_id: actorId, online_at: new Date().toISOString() }).catch(() => publish(current, new Set()));
        } else {
          publish(current, new Set());
        }
      });
    }).catch(() => { if (owner.current === current) publish(current, new Set()); });
  }
  if (entry.disposal) clearTimeout(entry.disposal);
  entry.listeners.add(listener);
  const current = entry;
  const owner = registry;
  queueMicrotask(() => { if (current.listeners.has(listener)) listener(current.online); });
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      // Keep the subscription through React StrictMode's setup/cleanup replay.
      current.disposal = setTimeout(() => { if (owner.current === current && !current.listeners.size) close(client, owner, current); }, 0);
    }
  };
}

const empty = new Set<string>();
export function useMemberPresence(actorId: string | null | undefined) {
  const [state, setState] = useState<{ actorId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!actorId) return;
    return subscribe(actorId, (ids) => setState({ actorId, ids }));
  }, [actorId]);
  return actorId && state?.actorId === actorId ? state.ids : empty;
}
