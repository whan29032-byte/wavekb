import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PostComments } from "./post-comments";

const meta = {
  title: "Community/Post comments",
  component: PostComments,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-4xl px-4 py-10"><Story /></main>],
  args: {
    postId: "11111111-1111-4111-8111-111111111111",
    actorId: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
    activeMember: true,
    commentsEnabled: true,
    comments: [{ id: "1", post_id: "11111111-1111-4111-8111-111111111111", author_id: "2", parent_id: null, body: "浪2未越过浪1起点，但成交量证据还不充分。", status: "visible", created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z", profiles: { id: "2", public_uid: 28419, display_name: "浪型记录者", avatar_url: null, role: "member" } }],
  },
} satisfies Meta<typeof PostComments>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ActiveMember: Story = {};
export const Anonymous: Story = { args: { actorId: undefined, activeMember: false } };
