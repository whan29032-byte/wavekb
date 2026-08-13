import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MentorThread } from "./mentor-thread";

const studentId = "79facf84-b98c-44f6-a223-b9ee4bc31f08";

const meta = {
  title: "Mentors/Tutoring thread",
  component: MentorThread,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-10"><Story /></main>],
  args: {
    actorId: studentId,
    thread: {
      thread_id: "11111111-1111-4111-8111-111111111111",
      mentor_id: "22222222-2222-4222-8222-222222222222",
      mentor_name: "林舟",
      mentor_avatar_url: null,
      student_id: studentId,
      status: "active",
      weekly_question_limit: 3,
      questions_used: 1,
      starts_at: "2026-08-01T08:00:00.000Z",
      ends_at: "2026-09-01T08:00:00.000Z",
    },
    initialMessages: [
      { id: 1, sender_id: studentId, message_kind: "question", body: "BTC 4 小时图里，当前主计数按三浪延长处理。若价格跌回一浪顶部下方，是否应立即切换到备选计数？", created_at: "2026-08-13T08:20:00.000Z" },
      { id: 2, sender_id: "33333333-3333-4333-8333-333333333333", message_kind: "reply", body: "先区分规则失效与形态降级。跌回一浪顶部会否定部分内部结构，但主计数的硬失效位仍要结合二浪起点。把两个价格都标在图上，再比较成交量与子浪比例。", created_at: "2026-08-13T09:05:00.000Z" },
    ],
  },
} satisfies Meta<typeof MentorThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveStudentThread: Story = {};
