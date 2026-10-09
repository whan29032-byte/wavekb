type ImageCallbacks = { start: () => void; cancel: () => void };
type ImageEntry = ImageCallbacks & { element: HTMLElement; visible: boolean; settled: boolean };
type ImageSchedule = { finish: () => void; dispose: () => void };

const documents = new WeakMap<Document, ReturnType<typeof createReadingImageScheduler>>();

/** Document-local admission only: never downloads, marks loaded, or changes source bytes. */
export function observeReadingImage(element: HTMLElement, callbacks: ImageCallbacks): ImageSchedule {
  const owner = element.ownerDocument;
  let scheduler = documents.get(owner);
  if (!scheduler) {
    scheduler = createReadingImageScheduler(owner, () => documents.delete(owner));
    documents.set(owner, scheduler);
  }
  return scheduler.register(element, callbacks);
}

export function createReadingImageScheduler(owner: Document, onEmpty = () => {}): { register: (element: HTMLElement, callbacks: ImageCallbacks) => ImageSchedule } {
  const view = owner.defaultView;
  const images = new Map<HTMLElement, ImageEntry>();
  let active: ImageEntry | undefined;
  let observer: IntersectionObserver | undefined;
  let scheduled = false;
  let frame: number | undefined;
  let disposed = false;
  let preference: "hash" | "focus" = "hash";

  function hashTarget() {
    try { return owner.getElementById(decodeURIComponent(view?.location.hash.slice(1) || "")); }
    catch { return null; }
  }

  function priority(entry: ImageEntry, hash: HTMLElement | null, focused: Element | null) {
    const contains = (target: Element | null) => Boolean(target && target !== owner.body && target !== owner.documentElement
      && (target.contains(entry.element) || entry.element.contains(target)));
    const matchesHash = contains(hash), matchesFocus = contains(focused);
    return preference === "hash" ? Number(matchesHash) * 2 + Number(matchesFocus) : Number(matchesFocus) * 2 + Number(matchesHash);
  }

  function visiblePosition(entry: ImageEntry) {
    if (!entry.visible || entry.settled) return null;
    const rect = entry.element.getBoundingClientRect();
    // IO with zero margin is authoritative when a partial browser/test does
    // not expose layout measurements. Real rectangles must also be in view.
    if (rect.width > 0 && rect.height > 0 && view
      && (rect.bottom <= 0 || rect.top >= view.innerHeight || rect.right <= 0 || rect.left >= view.innerWidth)) return null;
    return Math.max(0, rect.top);
  }

  function select() {
    scheduled = false; frame = undefined;
    if (disposed) return;
    const hash = hashTarget(), focused = owner.activeElement;
    // Batch all geometry reads before the component start/cancel writes.
    const candidates = [...images.values()].flatMap((entry) => {
      const position = visiblePosition(entry);
      return position === null ? [] : [{ entry, position, priority: priority(entry, hash, focused) }];
    }).sort((left, right) => right.priority - left.priority || left.position - right.position
      || (left.entry.element.compareDocumentPosition(right.entry.element) & 4 ? -1 : 1));
    const selected = candidates[0];
    const current = candidates.find(({ entry }) => entry === active);
    // Ordinary scrolling does not repeatedly abort a visible image. A new
    // explicit target may preempt it; leaving the viewport always releases it.
    if (active && current && (!selected || selected.entry === active || selected.priority <= current.priority)) return;
    if (active) { const previous = active; active = undefined; previous.cancel(); }
    if (selected) { active = selected.entry; active.start(); }
  }

  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    if (view && typeof view.requestAnimationFrame === "function") frame = view.requestAnimationFrame(select);
    else queueMicrotask(select);
  }

  function onFocus() { preference = "focus"; schedule(); }
  function onLocation() { preference = "hash"; schedule(); }
  function onViewport() { schedule(); }

  function failOpen() {
    try { observer?.disconnect(); } catch { /* Partial observers cannot prevent the readable fallback. */ }
    observer = undefined;
    for (const entry of images.values()) entry.visible = true;
  }

  try {
    if (view && typeof view.IntersectionObserver === "function") {
      observer = new view.IntersectionObserver((entries) => {
        for (const entry of entries) {
          const image = images.get(entry.target as HTMLElement);
          if (image) image.visible = entry.isIntersecting;
        }
        schedule();
      }, { rootMargin: "0px" });
    }
  } catch { /* A broken observer must not make source material unreadable. */ }
  owner.addEventListener("focusin", onFocus);
  view?.addEventListener("hashchange", onLocation);
  view?.addEventListener("popstate", onLocation);
  view?.addEventListener("wavekb:book-location", onLocation);
  view?.addEventListener("scroll", onViewport, { passive: true, capture: true });
  view?.addEventListener("resize", onViewport, { passive: true });

  return {
    register(element, callbacks) {
      const entry: ImageEntry = { element, ...callbacks, visible: !observer, settled: false };
      images.set(element, entry);
      try { observer?.observe(element); } catch { failOpen(); }
      schedule();
      let removed = false;
      return {
        finish() {
          if (removed || entry.settled) return;
          entry.settled = true;
          if (active === entry) active = undefined;
          schedule();
        },
        dispose() {
          if (removed) return;
          removed = true; images.delete(element);
          try { observer?.unobserve?.(element); } catch { /* Continue releasing the active request and document. */ }
          if (active === entry) { active = undefined; entry.cancel(); }
          if (images.size) { schedule(); return; }
          disposed = true;
          try { observer?.disconnect(); } catch { /* Browser cleanup remains best-effort; ownership is released. */ }
          if (frame !== undefined) view?.cancelAnimationFrame(frame);
          owner.removeEventListener("focusin", onFocus);
          view?.removeEventListener("hashchange", onLocation);
          view?.removeEventListener("popstate", onLocation);
          view?.removeEventListener("wavekb:book-location", onLocation);
          view?.removeEventListener("scroll", onViewport, true);
          view?.removeEventListener("resize", onViewport);
          onEmpty();
        },
      };
    },
  };
}
