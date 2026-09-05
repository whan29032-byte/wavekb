const eventName = "wavekb:identity:changed";

// Invalidation only: consumers re-read authorized data, never trust styles from a browser event.
export function notifyIdentityChanged(actorId: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: actorId }));
  try { localStorage.setItem(eventName, JSON.stringify({ actorId, revision: crypto.randomUUID() })); } catch { /* Private mode still gets same-page updates. */ }
}

export function subscribeIdentityChanges(listener: (actorId: string) => void) {
  const local = (event: Event) => { const id: unknown = (event as CustomEvent).detail; if (typeof id === "string" && id) listener(id); };
  const remote = (event: StorageEvent) => {
    if (event.key !== eventName || !event.newValue) return;
    try { const value = JSON.parse(event.newValue); if (typeof value?.actorId === "string" && value.actorId) listener(value.actorId); } catch { /* Ignore malformed storage. */ }
  };
  window.addEventListener(eventName, local); window.addEventListener("storage", remote);
  return () => { window.removeEventListener(eventName, local); window.removeEventListener("storage", remote); };
}
