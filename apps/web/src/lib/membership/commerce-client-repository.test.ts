import { describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { membershipCommerceRepository } from "./commerce-client-repository";

const actor="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",request="33333333-3333-4333-8333-333333333333";
const price={id:request,plan_key:"vip",term_months:1 as const,amount_minor:5200,currency:"USD" as const,published:true,revision:2};
const plan={key:"vip",title:"VIP 会员",description:"测试方案",benefits:{ai_daily_analysis:"平台 AI"},enabled:true,revision:2,ai_daily_limit:50,mentor_discount_bps:1000,prices:[price]};
const settings={billing_enabled:false,payment_mode:"test" as const,revision:2};
const catalog={billing_enabled:false,payment_mode:"test" as const,settings_revision:1,purchase_available:false,plans:[plan]};
const mine={catalog,orders:[],purchase_grants:[],effective:{user_id:actor,eligible:true,has_vip:false,ai_daily_limit:0,mentor_discount_bps:0}};
const store={settings,plans:[plan],history:[]};
const priceInput={id:request,planKey:"vip",termMonths:1 as const,amountMinor:5200,currency:"USD" as const,published:true,revision:1,reason:"确认价格配置",requestId:request};
const entitlementInput={planKey:"vip",aiDailyLimit:50,mentorDiscountBps:1000,revision:1,reason:"确认结构权益",requestId:request};
const settingsInput={billingEnabled:false,paymentMode:"test" as const,revision:1,reason:"确认支付关闭",requestId:request};
function setup(data:unknown,error:unknown=null) {
  const getUser=vi.fn().mockResolvedValue({data:{user:{id:actor}},error:null}),rpc=vi.fn().mockResolvedValue({data,error}),from=vi.fn();
  return {repo:membershipCommerceRepository({auth:{getUser},rpc,from} as unknown as SupabaseClient,actor),getUser,rpc,from};
}
type Operation="mine"|"adminStore"|"savePrice"|"saveEntitlements"|"saveSettings";
const operations:Operation[]=["mine","adminStore","savePrice","saveEntitlements","saveSettings"];
const receipts={mine,adminStore:store,savePrice:price,saveEntitlements:plan,saveSettings:settings};
function invoke(repo:ReturnType<typeof membershipCommerceRepository>,op:Operation) {
  if(op==="savePrice") return repo.savePrice(priceInput);
  if(op==="saveEntitlements") return repo.saveEntitlements(entitlementInput);
  if(op==="saveSettings") return repo.saveSettings(settingsInput);
  return repo[op]();
}
describe("commerce repository auth and receipt binding",()=>{
  it("public catalog is safe for logged-out server callers without an auth bypass on private methods",async()=>{
    const {repo,getUser,rpc}=setup(catalog); expect(await repo.catalog()).toEqual(catalog); expect(getUser).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledWith("list_membership_catalog",undefined);
  });
  it.each(operations)("refuses %s before RPC on changed actor",async(op)=>{
    const {repo,getUser,rpc}=setup(receipts[op]); getUser.mockResolvedValueOnce({data:{user:{id:other}},error:null});
    await expect(invoke(repo,op)).rejects.toThrow("authentication_required"); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(operations)("rejects successful %s after identity changes in flight",async(op)=>{
    const {repo,getUser,rpc}=setup(receipts[op]); getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:other}},error:null});
    await expect(invoke(repo,op)).rejects.toThrow("authentication_required"); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(operations)("propagates RPC/schema errors for %s, never fabricates success",async(op)=>{
    const error={message:"PGRST202 schema cache missing"},{repo}=setup(receipts[op],error); await expect(invoke(repo,op)).rejects.toEqual(error);
  });
  it.each(operations.flatMap(op=>[null,{},[],true].map(data=>({op,data}))))("rejects malformed $op receipt $data",async({op,data})=>{
    await expect(invoke(setup(data).repo,op)).rejects.toThrow("membership_commerce_response_invalid");
  });
  it("binds mine and admin to actor, and rejects valid-shaped wrong account",async()=>{
    const {repo,rpc,from}=setup(mine); await expect(repo.mine()).resolves.toEqual(mine); expect(rpc).toHaveBeenCalledWith("get_my_membership_commerce",{p_actor_id:actor});
    rpc.mockResolvedValueOnce({data:store,error:null}); await repo.adminStore(); expect(rpc).toHaveBeenLastCalledWith("admin_membership_commerce_store",{p_actor_id:actor}); expect(from).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({data:{...mine,effective:{...mine.effective,user_id:other}},error:null}); await expect(repo.mine()).rejects.toThrow("membership_commerce_response_invalid");
  });
  it("matches price identity, amount, currency, publication and CAS against the mutation",async()=>{
    const {repo,rpc}=setup(price); await expect(repo.savePrice(priceInput)).resolves.toEqual(price);
    expect(rpc).toHaveBeenCalledWith("admin_save_membership_price",{p_price_id:request,p_plan_key:"vip",p_term_months:1,p_amount_minor:5200,p_currency:"USD",p_published:true,p_expected_revision:1,p_reason:priceInput.reason,p_request_id:request,p_actor_id:actor});
    for(const patch of [{id:other},{plan_key:"other"},{amount_minor:52000},{currency:"CNY"},{term_months:12},{published:false},{revision:3}]) { rpc.mockResolvedValueOnce({data:{...price,...patch},error:null}); await expect(repo.savePrice(priceInput)).rejects.toThrow("membership_commerce_response_invalid"); }
  });
  it("matches structured entitlements and settings to request without trusting a generic success",async()=>{
    const {repo,rpc}=setup(plan); await expect(repo.saveEntitlements(entitlementInput)).resolves.toEqual(plan);
    expect(rpc).toHaveBeenCalledWith("admin_save_membership_entitlements",{p_plan_key:"vip",p_ai_daily_limit:50,p_mentor_discount_bps:1000,p_expected_revision:1,p_reason:entitlementInput.reason,p_request_id:request,p_actor_id:actor});
    for(const patch of [{key:"other"},{ai_daily_limit:49},{mentor_discount_bps:9000},{revision:3}]) { rpc.mockResolvedValueOnce({data:{...plan,...patch},error:null}); await expect(repo.saveEntitlements(entitlementInput)).rejects.toThrow(); }
    rpc.mockResolvedValueOnce({data:settings,error:null}); await expect(repo.saveSettings(settingsInput)).resolves.toEqual(settings);
    expect(rpc).toHaveBeenLastCalledWith("admin_save_membership_commerce_settings",{p_billing_enabled:false,p_payment_mode:"test",p_expected_revision:1,p_reason:settingsInput.reason,p_request_id:request,p_actor_id:actor});
    for(const patch of [{billing_enabled:true},{payment_mode:"live"},{revision:3}]) { rpc.mockResolvedValueOnce({data:{...settings,...patch},error:null}); await expect(repo.saveSettings(settingsInput)).rejects.toThrow(); }
  });
});
