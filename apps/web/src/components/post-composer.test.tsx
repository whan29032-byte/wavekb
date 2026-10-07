import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityPost, PrivateEntry } from "@wavekb/domain";
import { compileStructuredPost, type StructuredPost } from "@/lib/community/research-catalog";
import { installBrowserStorage } from "@/test/browser-storage";
import { PostComposer } from "./post-composer";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), createPost: vi.fn(), updatePost: vi.fn(), assign: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/community/client-repository", () => ({ createPost: mocks.createPost, updatePost: mocks.updatePost }));
vi.mock("@/lib/env", () => ({ publicPostImageUrl: (path: string) => `/test-images/${path}` }));

const actor = "22222222-2222-4222-8222-222222222222";
const postId = "11111111-1111-4111-8111-111111111111";
const draftKey = `wavekb:next:composer:${actor}:idea_sharing:new`;
const storageWarning = /草稿.*(?:未能保存|无法保存|保存失败)|(?:无法|未能)保存.*草稿|本地存储.*不可用/;
const title = "需要保留的波浪分析标题";
const body = "正文包含待验证的结构、确认条件与失效边界，需要完整保留。";
const structured: StructuredPost = {
  market: "crypto", instrument: "BINANCE:BTCUSDT", timeframe: "4小时", pattern: "impulse", position: "浪3", direction: "up",
  thesis: "等待同级别确认", evidence: "先核验硬规则", invalidation: "跌破起点", question: "第三浪是否延长？",
  primaryCount: "", alternateCount: "", confirmation: "", application: "控制仓位", notes: "",
};
const post: CommunityPost = {
  id: postId, board: "idea_sharing", title, body, author_id: actor, status: "published",
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
  external_url: null, external_kind: null, chart_package: null, comments_enabled: true,
  post_images: [], external_references: [], timeline_nodes: [], profiles: null,
};
const source: PrivateEntry = {
  id: "source-a", owner_id: actor, kind: "review", title: "私人记录的公开副本标题", body,
  instrument: "BTC", market: "crypto", timeframe: "4小时", tags: [], knowledge_ids: [], workbench_analysis_id: null,
  review_data: {}, created_at: post.created_at, updated_at: post.updated_at, deleted_at: null, private_entry_images: [],
};
const chart = {
  version: 1, provider: "tradingview", chart_url: "https://www.tradingview.com/chart/offline-test/",
  symbol: "BINANCE:BTCUSDT", interval: "240", theme: "dark", imported_at: "2026-10-01T00:00:00.000Z",
  layout: { content: { drawings: [{ name: "saved wave count" }] } },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const valueOf = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
async function restored() {
  // Allow the draft restore timer to finish before simulating user input.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
function fillSimple() { change("标题", title); change("正文", body); }
function submit() { fireEvent.submit(screen.getByLabelText("标题").closest("form")!); }
type Attachment = "links" | "chart";
function disclosure(attachment: Attachment) {
  return screen.getByRole("button", { name: attachment === "links" ? /^添加链接/ : /^添加图表/ });
}
function attachmentPanel(attachment: Attachment) {
  const id = disclosure(attachment).getAttribute("aria-controls");
  expect(id).toBe(attachment === "links" ? "post-media-fields" : "post-chart-fields");
  return document.getElementById(id!)!;
}
function setAttachmentOpen(attachment: Attachment, open: boolean) {
  if (disclosure(attachment).getAttribute("aria-expanded") !== String(open)) fireEvent.click(disclosure(attachment));
  expect(disclosure(attachment).getAttribute("aria-expanded")).toBe(String(open));
  expect(attachmentPanel(attachment).hidden).toBe(!open);
}
function selectImage() {
  const file = new File(["offline screenshot"], "wave.png", { type: "image/png" });
  fireEvent.change(document.querySelector<HTMLInputElement>("#post-images")!, { target: { files: [file] } });
  return file;
}

let browserErrors: unknown[] = [];
let realWindow: Window & typeof globalThis;
const captureBrowserError = (event: ErrorEvent) => { browserErrors.push(event.error); event.preventDefault(); };

beforeEach(() => {
  installBrowserStorage();
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.createPost.mockReset().mockResolvedValue(postId);
  mocks.updatePost.mockReset().mockResolvedValue({ cleanupPending: false });
  mocks.assign.mockReset();
  browserErrors = [];
  realWindow = window;
  realWindow.addEventListener("error", captureBrowserError);
  // jsdom Location.assign is not configurable. Intercept only navigation while
  // retaining the real document, events and timers used by React and RTL.
  vi.stubGlobal("window", new Proxy(realWindow, {
    get(target, property) {
      if (property === "location") return { origin: target.location.origin, assign: mocks.assign };
      return Reflect.get(target, property, target);
    },
  }));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request in offline composer test"); }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:offline-post-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  realWindow.removeEventListener("error", captureBrowserError);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PostComposer offline draft protection", () => {
  it("restores text and multiple media references for the same account", async () => {
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    setAttachmentOpen("links", true);
    change("媒体引用 1", "https://youtu.be/abcdefgh");
    fireEvent.click(screen.getByRole("button", { name: "添加引用" }));
    change("媒体引用 2", "https://x.com/wavekb/status/123");
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain("status/123"));
    mounted.unmount(); render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored();
    expect(disclosure("links").getAttribute("aria-expanded")).toBe("true");
    expect(attachmentPanel("links").hidden).toBe(false);
    expect(valueOf("标题")).toBe(title); expect(valueOf("正文")).toBe(body);
    expect(valueOf("媒体引用 1")).toBe("https://youtu.be/abcdefgh");
    expect(valueOf("媒体引用 2")).toBe("https://x.com/wavekb/status/123");
  });

  it("recovers unsaved edits after a failed save and remount", async () => {
    mocks.updatePost.mockRejectedValue(new Error("network unavailable"));
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} post={post} />);
    await restored(); change("标题", "未提交的修改标题"); change("正文", `${body}新增的说明。`); submit();
    await screen.findByRole("alert");
    await waitFor(() => expect([...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index)!)).join(" ")).toContain("未提交的修改标题"));
    mounted.unmount(); render(<PostComposer board="idea_sharing" userId={actor} post={post} />);
    await restored();
    expect(valueOf("标题")).toBe("未提交的修改标题"); expect(valueOf("正文")).toBe(`${body}新增的说明。`);
  });

  it("warns when storage writes fail without crashing or promising local recovery", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("quota exceeded", "QuotaExceededError"); });
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    expect(await screen.findByText(storageWarning)).toBeDefined();
    expect(browserErrors).toEqual([]); expect(valueOf("正文")).toBe(body);
    expect((screen.getByRole("button", { name: "发布内容" }) as HTMLButtonElement).matches(":disabled")).toBe(false);
  });

  it("handles unreadable and unremovable browser storage without an uncaught error", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new DOMException("storage disabled", "SecurityError"); });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new DOMException("storage disabled", "SecurityError"); });
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored();
    expect(await screen.findByText(storageWarning)).toBeDefined();
    expect(browserErrors).toEqual([]);
    fillSimple();
    expect((screen.getByRole("button", { name: "发布内容" }) as HTMLButtonElement).matches(":disabled")).toBe(false);
  });

  it("navigates after a successful publish even when clearing the local draft fails", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain(title));
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new DOMException("storage disabled", "SecurityError"); });
    submit();
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
    expect(String(mocks.assign.mock.calls[0][0])).toContain(`/community/post/${postId}`);
    expect(mocks.createPost).toHaveBeenCalledTimes(1); expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not replace a private source with an unrelated ordinary new-post draft", async () => {
    localStorage.setItem(draftKey, JSON.stringify({ title: "普通新帖的旧标题", body: "无关草稿内容" }));
    render(<PostComposer board="idea_sharing" userId={actor} source={source} />);
    await restored();
    expect(valueOf("标题")).toBe(source.title); expect(valueOf("正文")).toBe(source.body);
  });

  it("isolates drafts when switching from private source A to source B", async () => {
    const sourceKey = `wavekb:next:composer:${actor}:idea_sharing:source:${source.id}`;
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} source={source} />);
    await restored(); change("标题", "来源A尚未提交的公开标题");
    await waitFor(() => expect(localStorage.getItem(sourceKey)).toContain("来源A尚未提交的公开标题"));
    const sourceB = { ...source, id: "source-b", title: "来源B的独立公开标题", body: `${body}这是另一份记录。` };
    mounted.rerender(<PostComposer board="idea_sharing" userId={actor} source={sourceB} />);
    await restored();
    expect(valueOf("标题")).toBe(sourceB.title); expect(valueOf("正文")).toBe(sourceB.body);
    expect(localStorage.getItem(sourceKey)).toContain("来源A尚未提交的公开标题");
  });

  it.each(["pagehide", "blur"])("flushes the latest text immediately on %s before the debounce elapses", async (event) => {
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    expect(localStorage.getItem(draftKey)).toBeNull();
    act(() => {
      if (event === "pagehide") window.dispatchEvent(new Event("pagehide"));
      else fireEvent.blur(screen.getByLabelText("正文"));
    });
    const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
    expect(saved).toMatchObject({ title, body });
  });

  it("keeps a stale edit draft until the user explicitly chooses the newer server version", async () => {
    const key = `wavekb:next:composer:${actor}:idea_sharing:${postId}`;
    localStorage.setItem(key, JSON.stringify({ title: "旧设备未提交标题", body, baseUpdatedAt: "2026-09-01T00:00:00.000Z" }));
    render(<PostComposer board="idea_sharing" userId={actor} post={post} />);
    await restored();
    expect(valueOf("标题")).toBe(post.title);
    expect(screen.getByLabelText("标题").matches(":disabled")).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(localStorage.getItem(key)).toContain("旧设备未提交标题");
    fireEvent.click(screen.getByRole("button", { name: /保留服务器|使用服务器/ }));
    expect(valueOf("标题")).toBe(post.title); expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByLabelText("标题").matches(":disabled")).toBe(false);
    expect(mocks.createPost).not.toHaveBeenCalled(); expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it("restores a stale local edit only after the user explicitly chooses it", async () => {
    const key = `wavekb:next:composer:${actor}:idea_sharing:${postId}`;
    localStorage.setItem(key, JSON.stringify({ title: "明确恢复的旧草稿标题", body: `${body}本机补充内容。`, baseUpdatedAt: "2026-09-01T00:00:00.000Z" }));
    render(<PostComposer board="idea_sharing" userId={actor} post={post} />);
    await restored();
    expect(valueOf("标题")).toBe(post.title); expect(screen.getByLabelText("正文").matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "恢复本机草稿" }));
    expect(valueOf("标题")).toBe("明确恢复的旧草稿标题"); expect(valueOf("正文")).toBe(`${body}本机补充内容。`);
    expect(screen.getByLabelText("正文").matches(":disabled")).toBe(false);
    expect(mocks.updatePost).not.toHaveBeenCalled();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ baseUpdatedAt: post.updated_at }));
  });

  it("restores edited captions and retained image choices without changing the original post", async () => {
    const originalImages = [
      { id: "image-a", storage_path: `${actor}/${postId}/a.png`, sort_order: 0, caption: "原始图注" },
      { id: "image-b", storage_path: `${actor}/${postId}/b.png`, sort_order: 1, caption: "第二张图" },
    ];
    const withImages = { ...post, post_images: originalImages };
    const key = `wavekb:next:composer:${actor}:idea_sharing:${postId}`;
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} post={withImages} />);
    await restored(); change("现有图片 1 说明", "更新后的图注");
    fireEvent.click(screen.getByRole("button", { name: "移除现有图片 2" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ keptImageIds: ["image-a"], imageCaptionsById: { "image-a": "更新后的图注" } }));
    mounted.unmount(); render(<PostComposer board="idea_sharing" userId={actor} post={withImages} />);
    await restored();
    expect(valueOf("现有图片 1 说明")).toBe("更新后的图注"); expect(screen.queryByAltText("现有图片 2")).toBeNull();
    expect(originalImages[0].caption).toBe("原始图注"); expect(originalImages).toHaveLength(2);
    submit(); await waitFor(() => expect(mocks.updatePost).toHaveBeenCalledTimes(1));
    expect(mocks.updatePost.mock.calls[0][2]).toMatchObject({ keptImageIds: ["image-a"], imageCaptionsById: { "image-a": "更新后的图注" } });
  });

  it("does not resurrect a published draft when debounce timers or unmount cleanup run", async () => {
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain(title));
    submit(); await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(draftKey)).toBeNull();
    mounted.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(localStorage.getItem(draftKey)).toBeNull();
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored();
    expect(valueOf("标题")).toBe(""); expect(valueOf("正文")).toBe("");
  });

  it("does not delete another tab's different draft when this tab's pending publish succeeds", async () => {
    const publication = deferred<string>(); mocks.createPost.mockReturnValue(publication.promise);
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain(title));
    submit(); await waitFor(() => expect(mocks.createPost).toHaveBeenCalledTimes(1));
    const otherTabDraft = { ...JSON.parse(localStorage.getItem(draftKey)!), title: "另一标签页尚未发布的独立标题", body: `${body}这是另一标签页的新输入。` };
    localStorage.setItem(draftKey, JSON.stringify(otherTabDraft));
    await act(async () => { publication.resolve(postId); });
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem(draftKey)!)).toEqual(otherTabDraft);
    expect(mocks.createPost.mock.calls[0][1]).toMatchObject({ title, body });
    mounted.unmount();
    expect(JSON.parse(localStorage.getItem(draftKey)!)).toEqual(otherTabDraft);
  });

  it("remounts the editor when accounts change and does not save the old account's text into the new key", async () => {
    const mounted = render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple();
    await waitFor(() => expect(localStorage.getItem(draftKey)).toContain(title));
    mounted.rerender(<PostComposer board="idea_sharing" userId="another-account" />);
    await restored();
    expect(valueOf("标题")).toBe(""); expect(valueOf("正文")).toBe("");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(localStorage.getItem("wavekb:next:composer:another-account:idea_sharing:new")).toBeNull();
    expect(localStorage.getItem(draftKey)).toContain(title);
  });
});

describe("PostComposer editing and submission", () => {
  it.each(["", "补充观察成交量"])("preserves a professional post without rewrapping the compiled body (notes %j)", async (notes) => {
    const originalBody = compileStructuredPost({ ...structured, notes }, "idea_sharing");
    render(<PostComposer board="idea_sharing" userId={actor} post={{ ...post, body: originalBody }} />);
    await restored(); submit();
    await waitFor(() => expect(mocks.updatePost).toHaveBeenCalledTimes(1));
    expect(mocks.updatePost.mock.calls[0][2].body).toBe(originalBody);
    expect(valueOf("正文")).toBe(notes);
  });

  it("preserves a noncanonical custom chapter body and its saved chart when saving", async () => {
    const customBody = "【核心观点】\n等待同级别确认，原始观点需要原样保留。\n\n【我的自定义章节】\n这部分手工记录不属于编辑器标准章节，不应在保存时消失。";
    render(<PostComposer board="idea_sharing" userId={actor} post={{ ...post, body: customBody, chart_package: chart }} />);
    await restored();
    expect(valueOf("正文")).toBe(customBody);
    submit(); await waitFor(() => expect(mocks.updatePost).toHaveBeenCalledTimes(1));
    expect(mocks.updatePost.mock.calls[0][2]).toMatchObject({
      body: customBody,
      chartPackage: { chart_url: chart.chart_url, symbol: chart.symbol, interval: chart.interval, theme: chart.theme, layout: chart.layout },
    });
  });

  it("loads the saved chart preview iframe only after an explicit preview click", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} post={{ ...post, body: compileStructuredPost(structured, "idea_sharing"), chart_package: chart }} />);
    await restored();
    expect(screen.queryByTitle(/TradingView 图表预览/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "识别并预览" }));
    const frame = await screen.findByTitle("BINANCE:BTCUSDT TradingView 图表预览");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toContain("symbol=BINANCE%3ABTCUSDT");
    expect(mocks.createPost).not.toHaveBeenCalled(); expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it("blocks a mismatched authenticated account and keeps the form contents", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "another-account" } }, error: null });
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple(); submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/登录.*(?:失效|重新登录)/);
    expect(mocks.createPost).not.toHaveBeenCalled(); expect(mocks.updatePost).not.toHaveBeenCalled();
    expect(valueOf("标题")).toBe(title); expect(valueOf("正文")).toBe(body);
  });

  it("allows only one submit while authentication and publication are pending", async () => {
    const auth = deferred<{ data: { user: { id: string } }; error: null }>();
    mocks.getUser.mockReturnValue(auth.promise);
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple(); submit(); submit();
    await act(async () => { auth.resolve({ data: { user: { id: actor } }, error: null }); });
    await waitFor(() => expect(mocks.assign).toHaveBeenCalled());
    expect(mocks.getUser).toHaveBeenCalledTimes(1); expect(mocks.createPost).toHaveBeenCalledTimes(1);
  });

  it("disables text, media and mode controls until the pending save completes", async () => {
    const publication = deferred<string>(); mocks.createPost.mockReturnValue(publication.promise);
    const { container } = render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple(); selectImage(); submit();
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    const controls = Array.from(container.querySelectorAll("input, textarea, select, button"));
    const disabled = controls.map((control) => control.matches(":disabled"));
    await act(async () => { publication.resolve(postId); });
    expect(disabled.every(Boolean)).toBe(true);
  });

  it.each([new Error("upload failed"), { message: "upload failed", code: "storage_error" }])("keeps the selected image, caption and media reference after an upload failure (%j)", async (error) => {
    mocks.createPost.mockRejectedValue(error);
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple(); const file = selectImage();
    setAttachmentOpen("links", true);
    change("待发布图片 1 说明", "浪型截图说明"); change("媒体引用 1", "https://youtu.be/abcdefgh"); submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/图片.*(?:上传|保存)/);
    expect(screen.getByAltText("待发布图片 1")).toBeDefined();
    expect(valueOf("待发布图片 1 说明")).toBe("浪型截图说明");
    expect(valueOf("媒体引用 1")).toBe("https://youtu.be/abcdefgh"); expect(valueOf("正文")).toBe(body);
    expect(mocks.createPost.mock.calls[0][1]).toMatchObject({ files: [file], imageCaptions: ["浪型截图说明"] });
    expect((screen.getByRole("button", { name: "发布内容" }) as HTMLButtonElement).matches(":disabled")).toBe(false);
  });

  it("announces image upload progress without claiming completion while work is pending", async () => {
    const publication = deferred<string>(); mocks.createPost.mockImplementation((_client, input) => {
      input.onProgress?.({ phase: "uploading", completed: 0, total: 1 });
      return publication.promise;
    });
    render(<PostComposer board="idea_sharing" userId={actor} />);
    await restored(); fillSimple(); selectImage(); submit();
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled());
    const status = screen.getAllByRole("status").map((region) => region.textContent).join(" ");
    const busy = screen.getByLabelText("标题").closest("form")!.getAttribute("aria-busy");
    await act(async () => { publication.resolve(postId); });
    expect(status).toMatch(/上传.*0\s*\/\s*1|上传.*0.*1/); expect(busy).toBe("true");
  });
});

describe("PostComposer keyboard access", () => {
  it("exposes a focusable native image selection button connected to the file input", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored();
    const button = screen.getByRole("button", { name: "选择图片" });
    const input = document.querySelector<HTMLInputElement>("#post-images")!;
    const chooseFile = vi.spyOn(input, "click").mockImplementation(() => undefined);
    expect(button.tagName).toBe("BUTTON"); expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    button.focus(); expect(document.activeElement).toBe(button);
    fireEvent.click(button); expect(chooseFile).toHaveBeenCalledTimes(1);
  });

  it("exposes a native professional-mode button with pressed state and stable focus", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored();
    const mode = screen.getByRole("button", { name: "专业分析" });
    expect(mode.tagName).toBe("BUTTON"); expect(mode.tabIndex).toBeGreaterThanOrEqual(0);
    expect(mode.getAttribute("aria-pressed")).toBe("false"); mode.focus(); fireEvent.click(mode);
    expect(screen.getByRole("button", { name: "专业分析" })).toBe(mode);
    expect(mode.getAttribute("aria-pressed")).toBe("true"); expect(document.activeElement).toBe(mode);
    expect(document.getElementById(mode.getAttribute("aria-controls")!)).not.toBeNull();
    fireEvent.click(mode);
    expect(mode.getAttribute("aria-pressed")).toBe("false"); expect(document.activeElement).toBe(mode);
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("PostComposer progressive attachment controls", () => {
  it("keeps optional attachments out of the initial accessible form while retaining the image and publish buttons", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored();
    for (const attachment of ["links", "chart"] as const) {
      const button = disclosure(attachment);
      expect(button.tagName).toBe("BUTTON"); expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      expect(button.getAttribute("aria-expanded")).toBe("false"); expect(attachmentPanel(attachment).hidden).toBe(true);
    }
    expect(screen.queryByRole("textbox", { name: "媒体引用 1" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "公开图表链接或品种代码" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement).rows).toBe(6);
    expect(screen.getByRole("button", { name: "选择图片" }).matches(":disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "发布内容" }).matches(":disabled")).toBe(false);
  });

  it("reveals professional research fields without expanding empty optional attachments", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored();
    fireEvent.click(screen.getByRole("button", { name: "专业分析" }));
    expect(screen.getByRole("heading", { name: "分析坐标" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "核心观点" })).toBeDefined();
    expect(disclosure("links").getAttribute("aria-expanded")).toBe("false");
    expect(disclosure("chart").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: "媒体引用 1" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "公开图表链接或品种代码" })).toBeNull();
  });

  it("preserves closed attachment values in both the local draft and publication payload", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored(); fillSimple();
    setAttachmentOpen("links", true); change("媒体引用 1", "https://youtu.be/abcdefgh");
    setAttachmentOpen("chart", true); change("公开图表链接或品种代码", "BINANCE:BTCUSDT");
    change("周期", "240"); change("主题", "dark");
    setAttachmentOpen("links", false); setAttachmentOpen("chart", false);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(JSON.parse(localStorage.getItem(draftKey)!)).toMatchObject({
      externalUrls: ["https://youtu.be/abcdefgh"], chartSource: "BINANCE:BTCUSDT", chartInterval: "240", chartTheme: "dark",
    });
    expect(screen.queryByRole("textbox", { name: "媒体引用 1" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "公开图表链接或品种代码" })).toBeNull();
    submit(); await waitFor(() => expect(mocks.createPost).toHaveBeenCalledTimes(1));
    expect(mocks.createPost.mock.calls[0][1]).toMatchObject({
      title, body, externalReferences: [{ url: "https://youtu.be/abcdefgh", kind: "youtube", sort_order: 0 }],
      chartPackage: { symbol: "BINANCE:BTCUSDT", interval: "240", theme: "dark" },
    });
  });

  it.each(["post", "legacy post", "draft", "legacy draft"])("automatically reveals existing attachment data from a %s without loading a chart iframe", async (origin) => {
    const url = "https://youtu.be/abcdefgh";
    if (origin.includes("draft")) {
      localStorage.setItem(draftKey, JSON.stringify({ title, body, chartSource: chart.symbol, ...(origin === "legacy draft" ? { externalUrl: url } : { externalUrls: [url] }) }));
      render(<PostComposer board="idea_sharing" userId={actor} />);
    } else {
      const existing = origin === "legacy post"
        ? { ...post, chart_package: chart, external_url: url, external_kind: "youtube" as const }
        : { ...post, chart_package: chart, external_references: [{ url, kind: "youtube" as const, sort_order: 0 }] };
      render(<PostComposer board="idea_sharing" userId={actor} post={existing} />);
    }
    await restored();
    expect(disclosure("links").getAttribute("aria-expanded")).toBe("true");
    expect(disclosure("chart").getAttribute("aria-expanded")).toBe("true");
    expect(attachmentPanel("links").hidden).toBe(false); expect(attachmentPanel("chart").hidden).toBe(false);
    expect((screen.getByRole("textbox", { name: "媒体引用 1" }) as HTMLInputElement).value).toBe(url);
    expect((screen.getByRole("textbox", { name: "公开图表链接或品种代码" }) as HTMLInputElement).value).toBe(origin.includes("draft") ? chart.symbol : chart.chart_url);
    expect(screen.queryByTitle(/TradingView 图表预览/)).toBeNull();
  });

  it("restores an empty reference array as one editable blank field without expanding it", async () => {
    localStorage.setItem(draftKey, JSON.stringify({ title, body, externalUrls: [] }));
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored();
    expect(disclosure("links").getAttribute("aria-expanded")).toBe("false"); expect(attachmentPanel("links").hidden).toBe(true);
    setAttachmentOpen("links", true);
    expect((screen.getByRole("textbox", { name: "媒体引用 1" }) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("textbox", { name: "媒体引用 2" })).toBeNull();
    submit(); await waitFor(() => expect(mocks.createPost).toHaveBeenCalledTimes(1));
    expect(mocks.createPost.mock.calls[0][1].externalReferences).toEqual([]);
  });

  it("reopens closed media fields and focuses the first invalid reference instead of an earlier valid link", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored(); fillSimple();
    setAttachmentOpen("links", true); change("媒体引用 1", "https://youtu.be/abcdefgh");
    fireEvent.click(screen.getByRole("button", { name: "添加引用" })); change("媒体引用 2", "https://example.com/unsupported");
    setAttachmentOpen("links", false); submit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "媒体引用 2" })));
    expect(disclosure("links").getAttribute("aria-expanded")).toBe("true"); expect(attachmentPanel("links").hidden).toBe(false);
    const invalid = screen.getByRole("textbox", { name: "媒体引用 2" });
    expect(invalid.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(invalid.getAttribute("aria-describedby")!)?.textContent).toMatch(/YouTube|X/);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.createPost).not.toHaveBeenCalled();
    expect(valueOf("正文")).toBe(body); expect(valueOf("媒体引用 1")).toBe("https://youtu.be/abcdefgh");
  });

  it("reopens closed chart fields and focuses an invalid chart source before contacting authentication", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored(); fillSimple();
    setAttachmentOpen("chart", true); change("公开图表链接或品种代码", "https://example.com/unsupported-chart");
    setAttachmentOpen("chart", false); submit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "公开图表链接或品种代码" })));
    expect(disclosure("chart").getAttribute("aria-expanded")).toBe("true"); expect(attachmentPanel("chart").hidden).toBe(false);
    const input = screen.getByRole("textbox", { name: "公开图表链接或品种代码" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("TradingView");
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.createPost).not.toHaveBeenCalled(); expect(mocks.updatePost).not.toHaveBeenCalled();
    expect(valueOf("标题")).toBe(title); expect(valueOf("正文")).toBe(body);
  });

  it("retains attachment values, disclosure state and compiled content across simple and professional switches", async () => {
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored(); fillSimple();
    setAttachmentOpen("links", true); change("媒体引用 1", "https://youtu.be/abcdefgh");
    setAttachmentOpen("chart", true); change("公开图表链接或品种代码", "BINANCE:BTCUSDT");
    setAttachmentOpen("links", false); setAttachmentOpen("chart", false);
    fireEvent.click(screen.getByRole("button", { name: "专业分析" }));
    expect(valueOf("核心观点")).toBe(body);
    expect(disclosure("links").getAttribute("aria-expanded")).toBe("false"); expect(disclosure("chart").getAttribute("aria-expanded")).toBe("false");
    setAttachmentOpen("links", true);
    fireEvent.click(screen.getByRole("button", { name: "专业分析" }));
    const compiled = valueOf("正文"); expect(compiled).toContain(body);
    fireEvent.click(screen.getByRole("button", { name: "专业分析" }));
    expect(valueOf("核心观点")).toBe(body); expect(disclosure("links").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "专业分析" }));
    expect(valueOf("正文")).toBe(compiled); expect(disclosure("chart").getAttribute("aria-expanded")).toBe("false");
    expect(valueOf("媒体引用 1")).toBe("https://youtu.be/abcdefgh"); expect(valueOf("公开图表链接或品种代码")).toBe("BINANCE:BTCUSDT");
  });

  it("disables disclosure buttons during publication and restores them with attachments intact after failure", async () => {
    const publication = deferred<string>(); mocks.createPost.mockReturnValue(publication.promise);
    render(<PostComposer board="idea_sharing" userId={actor} />); await restored(); fillSimple(); selectImage();
    setAttachmentOpen("links", true); change("媒体引用 1", "https://youtu.be/abcdefgh");
    setAttachmentOpen("chart", true); change("公开图表链接或品种代码", "BINANCE:BTCUSDT"); submit();
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalledTimes(1));
    for (const attachment of ["links", "chart"] as const) expect(disclosure(attachment).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "专业分析" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("textbox", { name: "媒体引用 1" }).matches(":disabled")).toBe(true);
    await act(async () => { publication.reject(new Error("upload failed")); });
    await screen.findByRole("alert");
    for (const attachment of ["links", "chart"] as const) {
      expect(disclosure(attachment).matches(":disabled")).toBe(false); expect(disclosure(attachment).getAttribute("aria-expanded")).toBe("true");
    }
    expect(valueOf("媒体引用 1")).toBe("https://youtu.be/abcdefgh"); expect(valueOf("公开图表链接或品种代码")).toBe("BINANCE:BTCUSDT");
    expect(screen.getByAltText("待发布图片 1")).toBeDefined(); expect(valueOf("正文")).toBe(body);
  });
});
