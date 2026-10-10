import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ManagedAiModeSelector, type AiExecutionMode } from "./managed-ai-mode-selector";
const auth = vi.hoisted(() => ({ getUser: vi.fn(), onAuthStateChange: vi.fn() }));
const client = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client.create() }));
type AuthListener = (event: string, session: { user: { id: string } } | null) => void;
const listeners = new Set<AuthListener>();
const emitAuth = (id: string | null, event = "SIGNED_IN") => act(() => {
  for (const listener of listeners) listener(event, id ? { user: { id } } : null);
});
const status={user_id:"actor",usage_day:"2026-10-10",timezone:"Asia/Shanghai",has_vip:true,daily_limit:50,used:2,remaining:48,enabled:true,configured:true,available:true};
function Fixture(){ const [mode,setMode]=useState<AiExecutionMode>("byok"); return <ManagedAiModeSelector actorId="actor" value={mode} onChange={setMode} />; }
beforeEach(() => {
  listeners.clear(); auth.getUser.mockReset(); auth.onAuthStateChange.mockReset();
  client.create.mockReset(); client.create.mockReturnValue({ auth });
  auth.getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  auth.onAuthStateChange.mockImplementation((listener: AuthListener) => {
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("service-bound managed AI mode",()=>{
  it("keeps BYOK default and platform unavailable until authenticated server status is verified",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(status))); vi.stubGlobal("fetch",fetcher); render(<Fixture />);
    const platform=screen.getByRole("radio",{name:/平台 AI/}); expect((platform as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio",{name:/自带 Key/}) as HTMLInputElement).checked).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"核实平台会员额度"})); await waitFor(()=>expect((platform as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByText(/剩余 48 次/)).toBeDefined(); fireEvent.click(platform); expect((platform as HTMLInputElement).checked).toBe(true);
  });
  it("keeps the existing BYOK controls usable when auth configuration is missing and unlocks failed refresh", async () => {
    client.create.mockImplementation(() => { throw new Error("synthetic missing public auth configuration"); });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<Fixture />);
    expect((await screen.findByRole("alert")).textContent).toContain("当前环境未配置平台 AI 身份验证");
    const byok = screen.getByRole("radio", { name: /自带 Key/ }) as HTMLInputElement;
    expect(byok.checked).toBe(true); expect(byok.disabled).toBe(false);
    expect((screen.getByRole("radio", { name: /平台 AI/ }) as HTMLInputElement).disabled).toBe(true);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" }));
      await waitFor(() => expect((screen.getByRole("button", { name: "核实平台会员额度" }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByRole("alert").textContent).not.toContain("synthetic");
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(client.create).toHaveBeenCalledTimes(3);
  });
  it.each([{enabled:false,available:false},{configured:false,available:false},{has_vip:false,daily_limit:0,remaining:0,available:false},{remaining:0,used:50,available:false},{user_id:"other"}])("fails closed for unavailable or wrong-owner server status %o",async(override)=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({...status,...override})))); render(<Fixture />);
    fireEvent.click(screen.getByRole("button",{name:"核实平台会员额度"})); await waitFor(()=>expect((screen.getByRole("button",{name:"核实平台会员额度"}) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("radio",{name:/平台 AI/}) as HTMLInputElement).disabled).toBe(true); expect((screen.getByRole("radio",{name:/自带 Key/}) as HTMLInputElement).checked).toBe(true);
  });
  it.each([null, "other"])("immediately clears verified private quota and managed selection on logout/account change %s", async (id) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(status)))); render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" })); await screen.findByText(/剩余 48 次/);
    const platform = screen.getByRole("radio", { name: /平台 AI/ }) as HTMLInputElement;
    fireEvent.click(platform); expect(platform.checked).toBe(true);
    emitAuth(id, id ? "SIGNED_IN" : "SIGNED_OUT");
    expect(screen.queryByText(/剩余 48 次/)).toBeNull(); expect(platform.disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /自带 Key/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("登录账号已变化或退出");
  });
  it("discards a delayed old-owner body and does not let its finally unlock a newer request", async () => {
    let finishOld!: (value: unknown) => void; let finishNew!: (value: unknown) => void;
    const oldBody = new Promise((resolve) => { finishOld = resolve; }); const newBody = new Promise((resolve) => { finishNew = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: () => oldBody }).mockResolvedValueOnce({ ok: true, json: () => newBody });
    vi.stubGlobal("fetch", fetcher); render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    emitAuth("other"); emitAuth("actor");
    fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(async () => { finishOld(status); await oldBody; });
    expect(screen.queryByText(/剩余 48 次/)).toBeNull();
    expect((screen.getByRole("button", { name: "正在核实会员额度" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finishNew(status); await newBody; }); await screen.findByText(/剩余 48 次/);
    expect((screen.getByRole("radio", { name: /平台 AI/ }) as HTMLInputElement).disabled).toBe(false);
  });
  it.each(["before", "after"])("verifies the current actor %s the quota response even when no auth event reaches this page", async (phase) => {
    if (phase === "after") auth.getUser.mockResolvedValueOnce({ data: { user: { id: "actor" } }, error: null });
    auth.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(status))); vi.stubGlobal("fetch", fetcher); render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" })); await screen.findByRole("alert");
    expect(fetcher).toHaveBeenCalledTimes(phase === "before" ? 0 : 1); expect(screen.queryByText(/剩余 48 次/)).toBeNull();
    expect((screen.getByRole("radio", { name: /平台 AI/ }) as HTMLInputElement).disabled).toBe(true);
  });
  it("does not restore an old snapshot on same-owner sign-in but keeps same-owner token refresh usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(status)))); render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" })); await screen.findByText(/剩余 48 次/);
    emitAuth("actor", "TOKEN_REFRESHED"); expect(screen.getByText(/剩余 48 次/)).toBeDefined();
    emitAuth(null, "SIGNED_OUT"); emitAuth("actor"); expect(screen.queryByText(/剩余 48 次/)).toBeNull();
    expect((screen.getByRole("radio", { name: /平台 AI/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "核实平台会员额度" })); await screen.findByText(/剩余 48 次/);
  });
});
