import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MembershipCenter, MembershipSummary } from "./membership-center";

const mocks=vi.hoisted(()=>({auth:vi.fn(),mine:vi.fn(),refresh:vi.fn(),unsubscribe:vi.fn()}));
const router={refresh:mocks.refresh};
vi.mock("next/navigation",()=>({useRouter:()=>router}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:mocks.auth}})}));
vi.mock("@/lib/membership/client-repository",()=>({membershipRepository:()=>({mine:mocks.mine})}));
const snapshot={billing_enabled:false as const,grants:[{id:"grant",plan_key:"vip",title:"测试会员",status:"active" as const,starts_at:"2026-10-10T00:00:00Z",ends_at:"2026-11-10T00:00:00Z",revision:1,benefits:{}}],history:[]};
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockReturnValue({data:{subscription:{unsubscribe:mocks.unsubscribe}}});});
afterEach(cleanup);
it("shows dates and actual status without inventing benefits or a buy action",()=>{
  render(<MembershipSummary snapshot={snapshot} onRefresh={()=>{}} />);
  expect(screen.getByText("生效中")).toBeDefined(); expect(screen.getByText(/当前没有生效的专属权益/)).toBeDefined();
  expect(screen.getByText("2026/11/10 08:00")).toBeDefined(); expect(screen.queryByRole("button",{name:/购买|续费/})).toBeNull();
});
it("does not render unknown service state as free or paid membership",()=>{
  render(<MembershipSummary snapshot={null} error="会员服务尚未部署" onRefresh={()=>{}} />);
  expect(screen.getByRole("alert").textContent).toContain("尚未部署"); expect(screen.queryByText("免费注册会员")).toBeNull();
});
it("clears owner data at logout and never restores a late refresh response",async()=>{
  let finish!:(value:unknown)=>void; mocks.mine.mockReturnValue(new Promise((resolve)=>{finish=resolve;}));
  render(<MembershipCenter actorId="owner" initial={snapshot} />); fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));
  await waitFor(()=>expect(mocks.mine).toHaveBeenCalledOnce());
  await act(async()=>{mocks.auth.mock.calls[0][0]("SIGNED_OUT",null);});
  expect(screen.queryByText("测试会员")).toBeNull();
  await act(async()=>{finish(snapshot);}); expect(screen.queryByText("测试会员")).toBeNull(); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("a failed read removes stale membership claims and offers retry",async()=>{
  mocks.mine.mockRejectedValue(new Error("network failed")); render(<MembershipCenter actorId="owner" initial={snapshot} />);
  fireEvent.click(screen.getByRole("button",{name:"刷新状态"})); await screen.findByRole("alert");
  expect(screen.queryByText("测试会员")).toBeNull(); expect(screen.getByRole("button",{name:"刷新状态"})).toBeDefined();
});
