import type { CommunityPost } from "@wavekb/domain";
import { beforeEach, expect, it, vi } from "vitest";
import * as routeModule from "./page";

const repository = vi.hoisted(() => ({ getPost: vi.fn() }));
vi.mock("@/lib/community/server-repository", () => ({ getPost: repository.getPost, listPostComments: vi.fn() }));

const visiblePost: CommunityPost = {
  id: "post/id",
  board: "idea_sharing",
  title: "第三浪延伸如何确认",
  body: "结合价格结构、成交量和失效位确认第三浪延伸。",
  author_id: "author-1",
  status: "published",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  external_url: null,
  external_kind: null,
  chart_package: null,
  comments_enabled: true,
  post_images: [],
  external_references: [],
  timeline_nodes: [],
  profiles: null,
};

beforeEach(() => repository.getPost.mockReset());

function metadataGenerator() {
  return (routeModule as typeof routeModule & { generateMetadata?: (props: { params: Promise<{ id: string }> }) => Promise<Record<string, unknown>> }).generateMetadata;
}

it("returns useful article metadata with an encoded self canonical for a public post", async () => {
  repository.getPost.mockResolvedValueOnce(visiblePost);
  const generateMetadata = metadataGenerator();

  expect(generateMetadata).toBeTypeOf("function");
  if (!generateMetadata) return;
  const metadata = await generateMetadata({ params: Promise.resolve({ id: "post/id" }) });

  expect(metadata.title).toBe("第三浪延伸如何确认");
  expect(metadata.description).toBe("结合价格结构、成交量和失效位确认第三浪延伸。");
  expect(metadata.alternates).toMatchObject({ canonical: "/community/post/post%2Fid" });
  expect(metadata.openGraph).toMatchObject({ type: "article", url: "/community/post/post%2Fid" });
});

it.each([null, { ...visiblePost, status: "hidden" }])("marks an unavailable post noindex", async (post) => {
  repository.getPost.mockResolvedValueOnce(post);
  const generateMetadata = metadataGenerator();

  expect(generateMetadata).toBeTypeOf("function");
  if (!generateMetadata) return;
  const metadata = await generateMetadata({ params: Promise.resolve({ id: "unavailable" }) });

  expect(metadata.robots).toMatchObject({ index: false, follow: false });
  expect(metadata.alternates).toBeUndefined();
});
