import "server-only";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { directoryQuery } from "./directory";
import { researchWindow, validateResearchWindow } from "./presentation";
import { ResearchStore, type SyncState } from "./store";

type Query = Record<string, string | string[] | undefined>;

const emptyState = (): SyncState => ({ lastSuccess: null, watermark: null, lastAttempt: null, errorCode: null, retryAt: null });

export class LocalResearchNotFoundError extends Error {
  readonly status = 404;
  constructor() { super("Research was not found in the local catalogue"); this.name = "LocalResearchNotFoundError"; }
}

export class LocalResearchUnavailableError extends Error {
  constructor() { super("The saved research catalogue is unavailable"); this.name = "LocalResearchUnavailableError"; }
}

function databasePath(): string | null {
  const value = process.env.TLINE_RESEARCH_DB_PATH?.trim();
  return value || null;
}

function identifier(id: string): boolean {
  return Boolean(id && id !== "." && id !== ".." && id.length <= 200 && !/[\u0000-\u001f]/.test(id));
}

function delayed(state: SyncState, now: number): boolean {
  const last = state.lastSuccess === null ? Number.NaN : Date.parse(state.lastSuccess);
  return Boolean(state.errorCode) || (Number.isFinite(last) && now - last > 20 * 60_000);
}

export async function readResearchDirectory(params: Query) {
  // Request input is rejected before even inspecting the configured store path.
  const query = directoryQuery(params);
  validateResearchWindow(params);
  const path = databasePath();
  if (path && (!isAbsolute(path) || resolve(/* turbopackIgnore: true */ path) !== path)) throw new LocalResearchUnavailableError();
  if (!path || !existsSync(/* turbopackIgnore: true */ path)) {
    return {
      initialized: false, delayed: false,
      data: [], institutions: [], total: 0, available: 0, page: 1, pages: 1, institutionOptions: [],
      query, window: researchWindow(params, null), state: emptyState(),
    };
  }

  let store: ResearchStore | undefined;
  try {
    store = new ResearchStore(path, { readOnly: true });
    const state = store.status();
    const window = researchWindow(params, state.lastSuccess);
    return { initialized: state.lastSuccess !== null, delayed: delayed(state, Date.now()), ...store.query({ ...query, ...window }), query, window, state };
  } catch (error) {
    if (error instanceof LocalResearchNotFoundError || /时间窗口/.test(error instanceof Error ? error.message : "")) throw error;
    throw new LocalResearchUnavailableError();
  } finally {
    store?.close();
  }
}

export async function readResearch(id: string) {
  if (!identifier(id)) throw new LocalResearchNotFoundError();
  const path = databasePath();
  if (path && (!isAbsolute(path) || resolve(/* turbopackIgnore: true */ path) !== path)) throw new LocalResearchUnavailableError();
  if (!path || !existsSync(/* turbopackIgnore: true */ path)) throw new LocalResearchNotFoundError();
  let store: ResearchStore | undefined;
  try {
    store = new ResearchStore(path, { readOnly: true });
    const data = store.detail(id);
    if (!data) throw new LocalResearchNotFoundError();
    return { institutions: store.institutions(), data };
  } catch (error) {
    if (error instanceof LocalResearchNotFoundError) throw error;
    throw new LocalResearchUnavailableError();
  } finally {
    store?.close();
  }
}
