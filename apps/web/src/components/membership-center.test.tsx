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
  expect(screen.getByText("生效中")).toBeDefined(); expect(screen.getByText(/此授权没有补充权益说明/)).toBeDefined();
  expect(screen.getByText("2026/11/10 08:00")).toBeDefined(); expect(screen.queryByRole("button",{name:/购买|续费/})).toBeNull();
});
it("does not render unknown service state as free or paid membership",()=>{
  render(<MembershipSummary snapshot={null} error="会员服务尚未部署" onRefresh={()=>{}} />);
  expect(screen.getByRole("alert").textContent).toContain("尚未部署"); expect(screen.queryByText("免费注册会员")).toBeNull();
  expect(screen.queryByRole("region",{name:"免费账户可用服务"})).toBeNull();
});
it("clears owner data at logout and never restores a late refresh response",async()=>{
  let finish!:(value:unknown)=>void; mocks.mine.mockReturnValue(new Promise((resolve)=>{finish=resolve;}));
  render(<MembershipCenter actorId="owner" initial={snapshot} />); fireEvent.click(screen.getByRole("button",{name:"刷新状态"}));
  await waitFor(()=>expect(mocks.mine).toHaveBeenCalledOnce());
  await act(async()=>{mocks.auth.mock.calls[0][0]("SIGNED_OUT",null);});
  expect(screen.queryByText("测试会员")).toBeNull();
  expect(screen.queryByRole("region",{name:"免费账户可用服务"})).toBeNull();
  await act(async()=>{finish(snapshot);}); expect(screen.queryByText("测试会员")).toBeNull(); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it.each(["active","expired","revoked"] as const)("does not add a separate free-account product to VIP status (%s)",(status)=>{
  render(<MembershipSummary snapshot={{...snapshot,grants:[{...snapshot.grants[0],status}]}} onRefresh={()=>{}} />);
  expect(screen.queryByRole("region",{name:"免费账户可用服务"})).toBeNull();
  expect(screen.queryByText("免费注册会员")).toBeNull();
  expect(screen.getByText(/公开书籍和社区阅读保持免费/)).toBeDefined();
});
it("shows an empty authorization record without inventing a free-membership plan",()=>{
  render(<MembershipSummary snapshot={{...snapshot,grants:[]}} onRefresh={()=>{}} />);
  expect(screen.getByText(/暂无管理员授权记录/)).toBeDefined();
  expect(screen.queryByRole("heading",{name:"免费注册会员"})).toBeNull();
});
it("a failed read removes stale membership claims and offers retry",async()=>{
  mocks.mine.mockRejectedValue(new Error("network failed")); render(<MembershipCenter actorId="owner" initial={snapshot} />);
  fireEvent.click(screen.getByRole("button",{name:"刷新状态"})); await screen.findByRole("alert");
  expect(screen.queryByText("测试会员")).toBeNull(); expect(screen.getByRole("button",{name:"刷新状态"})).toBeDefined();
});
it.each(["owner","different-owner"])("offers a full-page identity recheck without restoring old data when signing back in as %s",async(nextOwner)=>{
  const {rerender}=render(<MembershipCenter key="owner" actorId="owner" initial={snapshot} />);
  await act(async()=>{mocks.auth.mock.calls[0][0]("SIGNED_OUT",null);mocks.auth.mock.calls[0][0]("SIGNED_IN",{user:{id:nextOwner}});});
  rerender(<MembershipCenter key="owner" actorId="owner" initial={{...snapshot,grants:[{...snapshot.grants[0],title:"服务器刷新返回的记录"}]}} />);
  expect(screen.queryByText("测试会员")).toBeNull();expect(screen.queryByText("服务器刷新返回的记录")).toBeNull();
  expect(screen.queryByRole("button",{name:"刷新状态"})).toBeNull();
  const link=screen.getByRole("link",{name:"重新核对当前账号"});
  expect(link.tagName).toBe("A");expect(link.getAttribute("href")).toBe("/membership");expect(link.className).toContain("min-h-11");
  expect(mocks.mine).not.toHaveBeenCalled();
});
