import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PostComposer } from "./post-composer";
import { compileStructuredPost } from "@/lib/community/research-catalog";

const post = {
  id: "11111111-1111-4111-8111-111111111111", board: "idea_sharing" as const, title: "BTC 4 小时推动浪的成立边界",
  body: "【核心观点】\n当前结构需要等同级别突破确认。", author_id: "79facf84-b98c-44f6-a223-b9ee4bc31f08", status: "published" as const,
  created_at: "2026-08-13T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z", external_url: null, external_kind: null,
  external_references: [], timeline_nodes: [],
  chart_package: { provider: "tradingview", schema_version: "wavekb-tv-v1", chart_url: "", symbol: "BINANCE:BTCUSDT", interval: "240", theme: "dark", layout: null },
  comments_enabled: true, post_images: [], profiles: { id: "79facf84-b98c-44f6-a223-b9ee4bc31f08", public_uid: 28419, display_name: "浪型记录者", avatar_url: null, role: "member" },
};

const meta = {
  title: "Community/Post composer",
  component: PostComposer,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto max-w-4xl px-4 py-10"><Story /></main>],
  args: { board: "idea_sharing", userId: post.author_id, post },
} satisfies Meta<typeof PostComposer>;

export default meta;
type Story = StoryObj<typeof meta>;
export const NewPost: Story = { args: { post: undefined } };
export const ProfessionalEditing: Story = {
  args: { post: { ...post, body: compileStructuredPost({
    market: "crypto", instrument: "BTC", timeframe: "4小时", pattern: "impulse", position: "浪3", direction: "up",
    thesis: "当前结构需要等同级别突破确认，失效前保留备选计数。", evidence: "浪2未越过浪1起点。", invalidation: "跌破结构起点。",
    question: "第三浪是否延长？", primaryCount: "", alternateCount: "", confirmation: "", application: "控制仓位。", notes: "",
  }, "idea_sharing") } },
};
export const LegacyEditing: Story = {};
