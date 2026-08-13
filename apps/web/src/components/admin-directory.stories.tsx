import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminDirectory } from "./admin-directory";

const meta = {
  title: "Admin/Home directory",
  component: AdminDirectory,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl px-4 py-10 md:px-6"><Story /></main>],
  args: {
    initialResources: [
      { id: "79facf84-b98c-44f6-a223-b9ee4bc31f08", platform: "x", name: "@waveobserver", description: "持续发布结构清晰的波浪复盘", url: "https://x.com/waveobserver", avatar_url: "https://unavatar.io/x/waveobserver", active: true, sort_order: 10, verified_at: "2026-08-14T00:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z" },
      { id: "52ea303d-c11d-4ffb-9653-3ac93f436805", platform: "discord", name: "Wave Research Lab", description: "面向实盘复盘的中文波浪社区", url: "https://discord.gg/wavelab", avatar_url: null, active: false, sort_order: 20, verified_at: "2026-08-12T00:00:00.000Z", created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z" },
    ],
  },
} satisfies Meta<typeof AdminDirectory>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
