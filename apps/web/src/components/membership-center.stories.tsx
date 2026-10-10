import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MembershipSummary } from "./membership-center";

const meta = { title: "Membership/Center", component: MembershipSummary, parameters: { layout:"fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6"><header><h1 className="text-3xl font-semibold">会员中心</h1><p className="mt-2 text-muted-foreground">组件预览 · 不是实际账户记录</p></header><Story /></main>],
  args: { snapshot: { billing_enabled:false, grants:[], history:[] }, onRefresh:()=>{} },
} satisfies Meta<typeof MembershipSummary>;
export default meta;
type Story=StoryObj<typeof meta>;
export const FreeMember:Story={};
export const ActiveMember:Story={args:{ snapshot:{ billing_enabled:false, grants:[{id:"preview",plan_key:"vip",title:"VIP 会员",status:"active",starts_at:"2026-10-10T00:00:00Z",ends_at:"2026-11-10T00:00:00Z",revision:1,benefits:{}}],history:[{id:"preview-event",action:"granted",title:"VIP 会员",created_at:"2026-10-10T00:00:00Z",ends_at:"2026-11-10T00:00:00Z"}] }}};
export const ServiceUnavailable:Story={args:{snapshot:null,error:"会员服务尚未部署，暂时不可使用。"}};
