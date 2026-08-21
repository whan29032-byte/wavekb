import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ResearchAuthor } from "./research-author";
import { ResearchBody } from "./research-body";
import { ResearchLightbox } from "./research-lightbox";
import { ResearchMedia } from "./research-media";
import { ResearchTimeline } from "./research-timeline";

const author = {
  id: "79facf84-b98c-44f6-a223-b9ee4bc31f08",
  public_uid: 33333,
  display_name: "浪型记录者",
  avatar_url: null,
  role: "member",
  display_title: "结构研究员",
  nameplate_style: "blackgold",
};

function ResearchDetailFixture() {
  return (
    <main className="mx-auto grid max-w-7xl gap-12 px-4 py-10 md:px-6">
      <article className="grid gap-12 md:gap-16">
        <header className="mx-auto grid w-full max-w-4xl gap-6 border-b pb-10">
          <p className="text-sm font-semibold tracking-[0.08em] text-primary">思路分享 · 市场观点</p>
          <h1 className="max-w-[20ch] text-[clamp(1.875rem,5vw,3rem)] font-semibold leading-[1.12] tracking-[-0.04em]">BTC 当前两种推动路径的确认边界</h1>
          <ResearchAuthor profile={author} createdAt="2026-08-15T07:43:00.000Z" updatedAt="2026-08-15T08:10:00.000Z" />
        </header>
        <section className="mx-auto w-full max-w-4xl">
          <ResearchBody body={"【当前判断】\n当前结构仍需等待同级别突破确认。\n\n1. 情景 A\n价格守住前低并完成五浪上行。\n\n2. 情景 B\n> 若跌破失效位，原计数作废。\n\n**执行原则：** 先确认，再交易。"} />
        </section>
        <section className="research-section">
          <header className="research-section-heading"><p>核心证据</p><h2>研究图表</h2><span>点击图片可放大、缩放并查看原图。</span></header>
          <ResearchLightbox assets={[
            { id: "chart-1", url: "/assets/figures-v10/page-097.png", alt: "BTC 波浪路径研究图", caption: "BTC 当前两种波浪路径推演" },
            { id: "chart-2", url: "/assets/figures-v10/page-043.png", alt: "BTC 备选路径研究图", caption: "备选计数与失效边界" },
          ]} />
        </section>
        <div className="mx-auto grid w-full max-w-4xl gap-12">
          <ResearchMedia references={[{ url: "https://youtu.be/M7lc1UVf-VE", kind: "youtube", sort_order: 0 }]} />
          <ResearchTimeline postId="11111111-1111-4111-8111-111111111111" createdAt="2026-08-15T07:43:00.000Z" author={author} nodes={[
            { id: "node-1", subject_type: "post", post_id: "11111111-1111-4111-8111-111111111111", private_entry_id: null, author_id: author.id, kind: "confirmed", body: "第一目标已经到达，原判断得到阶段性验证。", created_at: "2026-08-21T10:20:00.000Z", research_timeline_images: [], profiles: author },
          ]} />
        </div>
      </article>
    </main>
  );
}

const meta = {
  title: "Community/Research detail",
  component: ResearchDetailFixture,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ResearchDetailFixture>;

export default meta;
type Story = StoryObj<typeof meta>;
export const CompleteResearchArticle: Story = {};
