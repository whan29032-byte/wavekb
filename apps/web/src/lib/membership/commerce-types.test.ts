import { describe, expect, it } from "vitest";
import { membershipQuote, parseCommercePlan, parseCommerceSettings, parseEffectiveMembershipEntitlements, parseMembershipCatalog,
  parseMembershipCommerceAdminStore, parseMembershipOrder, parseMembershipPrice, parseMyMembershipCommerce } from "./commerce-types";

const id="11111111-1111-4111-8111-111111111111",buyer="22222222-2222-4222-8222-222222222222";
const price={id,plan_key:"vip",term_months:1 as const,amount_minor:5200,currency:"USD" as const,published:true,revision:1};
const plan={key:"vip",title:"VIP 会员",description:"单次购买",benefits:{ai_daily_analysis:"每日 50 次"},enabled:true,revision:2,ai_daily_limit:50,mentor_discount_bps:1000,prices:[price]};
const catalog={billing_enabled:false,payment_mode:"test" as const,purchase_available:false,settings_revision:1,plans:[plan]};
const effective={user_id:buyer,eligible:true,has_vip:false,ai_daily_limit:0,mentor_discount_bps:0};
const order={...membershipQuote(plan,price),id,buyer_id:buyer,request_id:id,payment_mode:"test" as const,livemode:false,status:"pending" as const,title_snapshot:plan.title,
  description_snapshot:plan.description,benefits_snapshot:plan.benefits,ai_daily_limit_snapshot:50,mentor_discount_bps_snapshot:1000,
  provider_session_id:null,checkout_url:null,checkout_expires_at:null,paid_at:null,created_at:"2026-10-10T00:00:00Z"};
const grant={id,order_id:id,plan_key:"vip",title:plan.title,benefits:plan.benefits,ai_daily_limit:50,mentor_discount_bps:1000,status:"test",starts_at:"2026-10-10T00:00:00Z",ends_at:"2026-11-10T00:00:00Z"};
const mine={catalog,effective,orders:[order],purchase_grants:[grant]};
const settings={billing_enabled:false,payment_mode:"test",revision:1};

describe("commerce strict response boundaries",()=>{
  it("reads canonical public product without making the disabled billing flag available",()=>{
    expect(parseMembershipCatalog(catalog)).toEqual(catalog); expect(membershipQuote(plan,price)).toEqual({price_id:id,plan_key:"vip",price_revision:1,plan_revision:2,amount_minor:5200,currency:"USD",term_months:1});
    expect(parseMyMembershipCommerce(mine)).toEqual(mine); expect(parseCommerceSettings(settings)).toEqual(settings);
    expect(parseMembershipCommerceAdminStore({settings,plans:[plan],history:[]})).toEqual({settings,plans:[plan],history:[]});
  });
  it.each([null,undefined,[],{},false,"success"])("rejects malformed receipt %s",(value)=>{
    for(const parser of [parseMembershipCatalog,parseMyMembershipCommerce,parseMembershipCommerceAdminStore,parseCommerceSettings,parseMembershipPrice,parseCommercePlan,parseMembershipOrder,parseEffectiveMembershipEntitlements]) expect(()=>parser(value)).toThrow("membership_commerce_response_invalid");
  });
  it.each([
    {amount_minor:0},{amount_minor:-1},{amount_minor:5.2},{amount_minor:100000001},{amount_minor:"5200"},{currency:"JPY"},{currency:"usd"},
    {term_months:2},{revision:0},{published:"true"},{id:"price_abc"},
  ])("refuses malformed or unsupported price %s",(patch)=>expect(()=>parseMembershipPrice({...price,...patch})).toThrow());
  it.each([{ai_daily_limit:"50"},{ai_daily_limit:null},{ai_daily_limit:-1},{ai_daily_limit:10001},{mentor_discount_bps:-1},{mentor_discount_bps:10000},{mentor_discount_bps:10001},{prices:[{...price,plan_key:"other"}]},{prices:[price,price]}])("rejects plan configuration %s",(patch)=>expect(()=>parseCommercePlan({...plan,...patch})).toThrow());
  it.each([
    {purchase_available:true},{billing_enabled:"false"},{payment_mode:"sandbox"},{settings_revision:0},{plans:[{...plan,enabled:false}]},
    {plans:[{...plan,prices:[{...price,published:false}]}]},{plans:[plan,plan]},
  ])("catalog fails closed on contradictory or malformed publication %s",(patch)=>expect(()=>parseMembershipCatalog({...catalog,...patch})).toThrow());
  it.each([
    {livemode:true},{payment_mode:"live"},{status:"complete"},{buyer_id:"bad"},{request_id:null},{paid_at:"infinity"},{title_snapshot:"\t\u00a0"},
    {status:"paid",paid_at:null},{provider_session_id:"cs_x",checkout_url:"https://evil.test",checkout_expires_at:"2026-10-10"},
    {provider_session_id:"cs_x",checkout_url:"https://checkout.stripe.com.evil.test/pay",checkout_expires_at:"2026-10-10"},
    {checkout_url:"https://checkout.stripe.com/pay"},{status:"expired"},
  ])("rejects broken/unsafe order route %s",(patch)=>expect(()=>parseMembershipOrder({...order,...patch})).toThrow());
  it("accepts complete registered payment route and Unicode code-point snapshot limits",()=>{
    const bound={...order,title_snapshot:"😀".repeat(60),description_snapshot:"中".repeat(1000),benefits_snapshot:{ai_daily_analysis:"😀".repeat(240)},provider_session_id:"cs_test",checkout_url:"https://checkout.stripe.com/c/pay/cs_test#fragment",checkout_expires_at:"2026-11-10T00:00:00Z"};
    expect(parseMembershipOrder(bound)).toEqual(bound); expect(()=>parseMembershipOrder({...bound,title_snapshot:"😀".repeat(61)})).toThrow();
  });
  it("accepts failed terminal receipts and historic discount snapshots while rejecting new 100% config",()=>{
    const bound={...order,status:"failed",provider_session_id:"cs_failed",checkout_url:"https://checkout.stripe.com/c/pay/failed",checkout_expires_at:"2026-11-10T00:00:00Z",mentor_discount_bps_snapshot:10000};
    expect(parseMembershipOrder(bound)).toEqual(bound);
    expect(parseMembershipOrder({...bound,checkout_url:null,checkout_expires_at:null})).toEqual({...bound,checkout_url:null,checkout_expires_at:null});
    expect(()=>parseMembershipOrder({...bound,status:'pending',checkout_url:null,checkout_expires_at:null})).toThrow();
    expect(parseMyMembershipCommerce({...mine,orders:[bound],purchase_grants:[{...grant,mentor_discount_bps:10000}]}).purchase_grants[0].mentor_discount_bps).toBe(10000);
    expect(parseCommercePlan({...plan,mentor_discount_bps:9900}).mentor_discount_bps).toBe(9900);
    expect(()=>parseCommercePlan({...plan,mentor_discount_bps:10000})).toThrow();
  });
  it.each([{orders:[{...order,buyer_id:id}]},{orders:[order,order]},{purchase_grants:[grant,grant]},{purchase_grants:[{...grant,ends_at:grant.starts_at}]},{effective:{...effective,eligible:false,has_vip:true}},{effective:{...effective,eligible:false,ai_daily_limit:50}}])("rejects incoherent member response %s",(patch)=>expect(()=>parseMyMembershipCommerce({...mine,...patch})).toThrow());
  it("only accepts strict textual audit events",()=>{
    const history=[{id,action:"price_updated",reason:"配置价格",created_at:"2026-10-10"}];
    expect(parseMembershipCommerceAdminStore({settings,plans:[plan],history}).history).toEqual(history);
    expect(()=>parseMembershipCommerceAdminStore({settings,plans:[plan],history:[{...history[0],action:{toString:()=>"price_updated"}}]})).toThrow();
  });
});
