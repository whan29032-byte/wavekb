import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AdminUsers } from "./admin-users";

const meta = {
  title: "Admin/User governance",
  component: AdminUsers,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-6xl px-4 py-10 md:px-6"><Story /></main>],
  args: {
    summary: { total_users: 1862, active_users: 1854, banned_users: 3, muted_users: 5, admin_users: 4, new_today: 18 },
    users: [
      {
        id: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
        email: "moderator@example.com",
        public_uid: 10001,
        display_name: "结构记录者",
        avatar_url: null,
        role: "admin",
        account_status: "active",
        muted_until: null,
        moderation_note: "",
        email_confirmed: true,
        last_sign_in_at: "2026-08-14T01:30:00.000Z",
        created_at: "2026-01-04T08:00:00.000Z",
      },
      {
        id: "52ea303d-c11d-4ffb-9653-3ac93f436805",
        email: "member@example.com",
        public_uid: 10942,
        display_name: "林舟",
        avatar_url: null,
        role: "user",
        account_status: "active",
        muted_until: "2026-08-15T01:30:00.000Z",
        moderation_note: "连续发布重复内容，临时禁言 24 小时",
        email_confirmed: true,
        last_sign_in_at: "2026-08-14T00:10:00.000Z",
        created_at: "2026-04-19T08:00:00.000Z",
      },
      {
        id: "eca1c4cc-8ef8-42f6-9207-0f0502c9ac57",
        email: "blocked@example.com",
        public_uid: 18351,
        display_name: "异常账号",
        avatar_url: null,
        role: "user",
        account_status: "banned",
        muted_until: null,
        moderation_note: "账号安全复核中",
        email_confirmed: false,
        last_sign_in_at: null,
        created_at: "2026-08-13T08:00:00.000Z",
      },
    ],
    total: 1862,
    page: 1,
    limit: 25,
    queryString: "",
  },
} satisfies Meta<typeof AdminUsers>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
