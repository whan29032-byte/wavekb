import Link from "next/link";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button, Field, Input, Label } from "@wavekb/ui";
import { AuthCard } from "./auth-card";

const meta = {
  title: "Auth/Auth card",
  component: AuthCard,
  parameters: { layout: "fullscreen" },
  args: {
    title: "登录 WaveKB",
    description: "使用邮箱或 5 至 6 位公开 UID 登录。",
    children: <form className="grid gap-5"><Field><Label htmlFor="story-account">邮箱或 UID</Label><Input id="story-account" defaultValue="28419" /></Field><Field><Label htmlFor="story-password">密码</Label><Input id="story-password" type="password" defaultValue="password" /></Field><Button type="button">登录</Button></form>,
    footer: <span>还没有账号？ <Link className="font-semibold text-primary" href="/register">创建账号</Link></span>,
  },
} satisfies Meta<typeof AuthCard>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Login: Story = {};
