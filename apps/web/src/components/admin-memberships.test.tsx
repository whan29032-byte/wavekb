import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminMemberships, MembershipPlanForm, parseBenefitLines } from "./admin-memberships";
const mocks=vi.hoisted(()=>({auth:vi.fn(),store:vi.fn(),save:vi.fn(),change:vi.fn(),unsubscribe:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({})}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{onAuthStateChange:mocks.auth}})}));
vi.mock("@/lib/membership/client-repository",()=>({membershipRepository:()=>({adminStore:mocks.store,savePlan:mocks.save,change:mocks.change})}));
const plan={key:"vip",title:"VIP 会员",description:"未收费",benefits:{},enabled:false,revision:1};
const store={plans:[plan],member:null,grants:[],history:[]};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockReturnValue({data:{subscription:{unsubscribe:mocks.unsubscribe}}});});
afterEach(cleanup);
it("parses explicit benefit codes and rejects duplicate, malformed or excessive lines",()=>{
  expect(parseBenefitLines("notes=专属笔记\nquota=测试额度")).toEqual({notes:"专属笔记",quota:"测试额度"});
  expect(()=>parseBenefitLines("notes=a\nnotes=b")).toThrow(); expect(()=>parseBenefitLines("garbage")).toThrow(); expect(()=>parseBenefitLines("__proto__=bad")).toThrow();
});
it("shows invalid benefit input inline rather than throwing out of submit",async()=>{
  const save=vi.fn(); render(<MembershipPlanForm plan={plan} pending={false} save={save} />);
  fireEvent.change(screen.getByLabelText("权益清单"),{target:{value:"no separator"}}); fireEvent.change(screen.getByLabelText("变更原因"),{target:{value:"测试原因"}});
  fireEvent.submit(screen.getByLabelText("权益清单").closest("form")!);
  expect(screen.getByRole("alert").textContent).toContain("格式"); expect(save).not.toHaveBeenCalled();
});
it("keeps the request id after lost response, and does not claim success",async()=>{
  mocks.save.mockRejectedValue(new Error("ack lost")); render(<AdminMemberships actorId="admin" initial={store} />);
  fireEvent.change(screen.getByLabelText("变更原因"),{target:{value:"测试原因"}}); const form=screen.getByLabelText("变更原因").closest("form")!;
  fireEvent.submit(form); await screen.findByRole("alert"); expect(screen.queryByText(/方案已保存/)).toBeNull();
  const request=mocks.save.mock.calls[0][0].requestId;
  fireEvent.submit(form); await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1][0].requestId).toBe(request);
});
it("does not query or show success after the admin account changes during a mutation",async()=>{
  let finish!:()=>void; mocks.save.mockReturnValue(new Promise<void>((resolve)=>{finish=resolve;})); render(<AdminMemberships actorId="admin" initial={store} />);
  fireEvent.change(screen.getByLabelText("变更原因"),{target:{value:"测试原因"}}); fireEvent.submit(screen.getByLabelText("变更原因").closest("form")!);
  await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());
  await act(async()=>{mocks.auth.mock.calls[0][0]("SIGNED_OUT",null);}); await act(async()=>{finish();});
  expect(mocks.store).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("已清除");
});
it("removes the old actionable target before a new UID lookup and keeps it removed after failure",async()=>{
  let reject!:(error:Error)=>void;
  mocks.store.mockReturnValue(new Promise((_,failure)=>{reject=failure;}));
  render(<AdminMemberships actorId="admin" initial={{...store,member:{id:"previous-user",public_uid:10002,display_name:"前一个用户",account_status:"active"}}} />);
  expect(screen.getByRole("button",{name:"提交会员变更"})).toBeDefined();
  fireEvent.change(screen.getByLabelText("站内 UID"),{target:{value:"99999"}});
  fireEvent.submit(screen.getByLabelText("站内 UID").closest("form")!);
  await waitFor(()=>expect(mocks.store).toHaveBeenCalledWith(99999));
  expect(screen.queryByText(/前一个用户/)).toBeNull(); expect(screen.queryByRole("button",{name:"提交会员变更"})).toBeNull();
  await act(async()=>{reject(new Error("member_not_found"));});
  expect(screen.getByRole("alert").textContent).toContain("没有找到"); expect(screen.queryByRole("button",{name:"提交会员变更"})).toBeNull();
  expect(mocks.change).not.toHaveBeenCalled();
});
