import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MembershipPlanForm } from "./admin-memberships";
const meta={title:"Membership/Admin plan",component:MembershipPlanForm,parameters:{layout:"fullscreen"},
  decorators:[(Story)=><main className="mx-auto max-w-3xl px-4 py-8"><header className="mb-6"><h1 className="text-3xl font-semibold">会员方案管理</h1><p className="mt-2 text-muted-foreground">组件预览 · 不提交实际授权</p></header><Story /></main>],
  args:{plan:{key:"vip",title:"VIP 会员",description:"会员方案待确认；未开放购买，不影响现有公开内容。",benefits:{},enabled:false,revision:1},pending:false,save:async()=>{}},
} satisfies Meta<typeof MembershipPlanForm>;
export default meta;
type Story=StoryObj<typeof meta>;
export const DefaultDisabled:Story={};
export const Saving:Story={args:{pending:true}};
