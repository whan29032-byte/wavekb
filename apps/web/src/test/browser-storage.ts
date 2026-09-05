import { vi } from "vitest";

// Node's experimental Web Storage can shadow jsdom's storage. Keep browser
// persistence local to each test and independent of the host Node version.
export function installBrowserStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  vi.stubGlobal("localStorage", storage);
}
