import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProfileEditor } from "./profile-editor";

const meta = {
  title: "Member/Profile editor",
  component: ProfileEditor,
  parameters: { layout: "fullscreen" },
  args: {
    profile: {
      id: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
      public_uid: 28419,
      display_name: "浪型记录者",
      avatar_url: null,
      bio: "只保留可以复查的判断。",
      markets: ["加密", "贵金属"],
      timeframes: ["日线", "4小时"],
      role: "member",
      display_title: "波浪研究者",
      nameplate_style: "blackgold",
      cover_url: null,
      cover_style: "wave-blue",
      created_at: "2026-08-13T00:00:00.000Z",
    },
    initialNameplates: [
      {
        id: "2b27b248-7dbf-4245-ad12-fdb67884c789",
        product_id: "f4172bd7-cd09-4012-b102-1dd3ed8ed064",
        product_name: "黑金研究铭牌",
        style: "blackgold",
        starts_at: "2026-08-01T00:00:00.000Z",
        expires_at: "2026-09-01T00:00:00.000Z",
        equipped: true,
        source: "redeemed",
      },
    ],
  },
} satisfies Meta<typeof ProfileEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
