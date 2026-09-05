export type PaginationQuery = Record<string, string | number | undefined>;
export type PaginatedResult<T> = { items: T[]; page: number; hasNext: boolean };

export function parsePage(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 1;
  if (!/^[1-9]\d*$/.test(String(value))) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= 1_000_000 ? page : 1;
}

/** Supabase ranges include both endpoints; add one to `to` to fetch a next-page sentinel. */
export function pageRange(page: number, size: number): { from: number; to: number } {
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError("Page size must be a positive integer.");
  const from = (parsePage(page) - 1) * size;
  const to = from + size - 1;
  if (!Number.isSafeInteger(to)) throw new RangeError("Page range is too large.");
  return { from, to };
}

export function paginationHref(pathname: string, page: number, query: PaginationQuery = {}, pageKey = "page"): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const normalized = parsePage(page);
  if (normalized === 1) params.delete(pageKey);
  else params.set(pageKey, String(normalized));
  const encoded = params.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}
