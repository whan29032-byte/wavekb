import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MemberProfileActions } from "./member-profile-actions";
import { MembershipPersonalCenterEntry } from "./membership-personal-center-entry";

const meta = {
  title: "Member/Personal center",
  component: MemberProfileActions,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:px-6"><header className="grid gap-2"><h1 className="text-3xl font-semibold">个人中心</h1><p className="text-sm leading-6 text-muted-foreground">虚拟组件预览，不读取真实账号，不提交支付或好友请求。</p></header><Story /></main>],
  args: {
    actorId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000001",
    initialFollowing: false,
    initialConnection: null,
    profile: { display_name: "预览研究者", public_uid: 12345, avatar_url: null, display_title: "", nameplate_style: "classic" },
  },
} satisfies Meta<typeof MemberProfileActions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OwnPublicProfile: Story = {};
export const OtherResearcher: Story = { args: { actorId: "00000000-0000-4000-8000-000000000099" } };
export const Guest: Story = { args: { actorId: null } };
export const PrivateProfile: Story = { render: () => <MembershipPersonalCenterEntry /> };
