import type { PublicProfile, ResearchTimelineNode, TimelineNodeKind } from "@wavekb/domain";
import { ResearchBody } from "@/components/research-body";
import { ResearchLightbox } from "@/components/research-lightbox";
import { ResearchTimelineComposer } from "@/components/research-timeline-composer";
import { publicPostImageUrl } from "@/lib/env";

const LABELS: Record<TimelineNodeKind, string> = {
  published: "发布观点", update: "更新观点", confirmed: "判断验证", invalidated: "判断失效",
  trade_started: "交易开始", position_added: "加仓", position_reduced: "减仓", stop_updated: "调整止损",
  target_hit: "到达目标", stop_hit: "到达止损", trade_closed: "手动结束", review: "复盘总结",
};

export function ResearchTimeline({ postId, createdAt, nodes, author, actorId }: {
  postId: string;
  createdAt: string;
  nodes: ResearchTimelineNode[];
  author: PublicProfile | null;
  actorId?: string;
}) {
  const entries: Array<Pick<ResearchTimelineNode, "id" | "kind" | "body" | "created_at" | "research_timeline_images" | "profiles">> = [
    { id: `published-${postId}`, kind: "published", body: "原始观点已发布。上方正文、图表与研究图片构成首个公开版本。", created_at: createdAt, research_timeline_images: [], profiles: author },
    ...nodes,
  ];
  return (
    <section className="research-section" aria-labelledby="research-timeline-title">
      <header className="research-section-heading"><p>持续记录</p><h2 id="research-timeline-title">观点追踪</h2><span>判断变化以新节点追加，不覆盖历史。</span></header>
      <ol className="research-timeline-list">
        {entries.map((node) => (
          <li key={node.id} className="research-timeline-node" data-kind={node.kind}>
            <span className="research-timeline-dot" aria-hidden />
            <article>
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3>{LABELS[node.kind]}</h3>
                <time dateTime={node.created_at}>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(node.created_at))}</time>
              </header>
              <ResearchBody body={node.body} compact />
              {node.research_timeline_images.length ? <ResearchLightbox assets={node.research_timeline_images.map((image, index) => ({ id: image.id, url: publicPostImageUrl(image.storage_path), alt: `${LABELS[node.kind]}，图片 ${index + 1}`, caption: image.caption }))} className="mt-4 grid gap-3 sm:grid-cols-2" /> : null}
            </article>
          </li>
        ))}
      </ol>
      {actorId ? <ResearchTimelineComposer postId={postId} userId={actorId} /> : null}
    </section>
  );
}
