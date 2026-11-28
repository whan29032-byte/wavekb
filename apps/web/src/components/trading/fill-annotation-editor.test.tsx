import type { FillMarker } from "@wavekb/domain/trading-review";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ loadFillAnnotation: vi.fn(), createFillAnnotationWrite: vi.fn() }));
vi.mock("@/lib/trading/fill-annotation-repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/trading/fill-annotation-repository")>(),
  ...repository,
}));
import { createFillAnnotationDraftScope, FillAnnotationEditor } from "./fill-annotation-editor";
import { FillAnnotationError } from "@/lib/trading/fill-annotation-repository";

const cycleId = "10000000-0000-4000-8000-000000000000";
const ownerId = "20000000-0000-4000-8000-000000000000";
const noteId = "30000000-0000-4000-8000-000000000000";
const fill: FillMarker = {
  marker_key: "3:42",
  fill_id: "42",
  occurred_at: "2026-11-01T00:15:00.123Z",
  price: "70000.125",
  allocated_quantity: "0.001",
  allocation_role: "open",
  sort_order: 0,
  side: "buy",
  position_side: "long",
  liquidity: "maker",
  provider_fill_id_mask: "••••1234",
  annotation: null,
};
const props = { cycleId, cycleRevision: 3, fill };
const blank = { ownerId, annotation: null, revision: null, deleted: false, images: [] };
const note = (body: string, version: number) => ({
  id: noteId, body, version, tags: [], image_count: 0, remap_status: "current" as const,
});
const result = (body: string, version: number) => ({
  snapshot: { ...blank, annotation: note(body, version), revision: 3 },
  uploadRolledBack: false,
});

async function mount(overrides: Partial<React.ComponentProps<typeof FillAnnotationEditor>> = {}) {
  const view = render(<FillAnnotationEditor {...props} {...overrides} />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

function changeMemo(value: string) {
  fireEvent.change(screen.getByLabelText("备忘录"), { target: { value } });
}

beforeEach(() => {
  vi.useFakeTimers();
  repository.loadFillAnnotation.mockResolvedValue(blank);
});
afterEach(async () => {
  await act(async () => { cleanup(); });
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("FillAnnotationEditor", () => {
  it("debounces note edits for 600 ms and serializes edits during an in-flight save", async () => {
    const onSaved = vi.fn();
    let resolveFirst!: (value: ReturnType<typeof result>) => void;
    const first = new Promise<ReturnType<typeof result>>((resolve) => { resolveFirst = resolve; });
    repository.createFillAnnotationWrite.mockReturnValueOnce(() => first).mockReturnValueOnce(async () => result("二次编辑", 2));
    await mount({ onSaved });

    changeMemo("第一笔");
    await act(() => vi.advanceTimersByTimeAsync(599));
    expect(repository.createFillAnnotationWrite).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("status").textContent).toContain("保存中");
    changeMemo("二次编辑");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(repository.createFillAnnotationWrite).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst(result("第一笔", 1)); });

    expect(repository.createFillAnnotationWrite.mock.calls[1]?.slice(1, 3)).toEqual([
      result("第一笔", 1).snapshot, { body: "二次编辑", tags: [] },
    ]);
    expect(onSaved).toHaveBeenLastCalledWith("42", note("二次编辑", 2));
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });

  it("flushes a valid draft when the selected fill changes before the timer fires", async () => {
    const onSaved = vi.fn();
    const write = vi.fn(async () => result("切换前的备忘", 1));
    repository.createFillAnnotationWrite.mockReturnValueOnce(write);
    const view = await mount({ onSaved });
    changeMemo("切换前的备忘");
    await act(async () => { view.unmount(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("retains a failed detached draft and its prepared retry when returning to the fill", async () => {
    const draftScope = createFillAnnotationDraftScope();
    const write = vi.fn().mockRejectedValueOnce(new FillAnnotationError("uncertain"))
      .mockResolvedValueOnce(result("离线时的草稿", 1));
    repository.createFillAnnotationWrite.mockReturnValueOnce(write);
    const original = await mount({ draftScope });
    changeMemo("离线时的草稿");
    await act(async () => { original.unmount(); });
    expect(write).toHaveBeenCalledTimes(1);

    await mount({ draftScope });
    expect((screen.getByLabelText("备忘录") as HTMLTextAreaElement).value).toBe("离线时的草稿");
    expect(screen.getByRole("alert").textContent).toContain("无法确认");
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试保存" })); });
    expect(repository.createFillAnnotationWrite).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });

  it("never restores another owner's detached memo or retries its write", async () => {
    const draftScope = createFillAnnotationDraftScope();
    const write = vi.fn().mockRejectedValueOnce(new FillAnnotationError("uncertain"));
    repository.createFillAnnotationWrite.mockReturnValueOnce(write);
    const original = await mount({ draftScope });
    changeMemo("原账号私有草稿");
    await act(async () => { original.unmount(); });

    repository.loadFillAnnotation.mockResolvedValueOnce({ ...blank, ownerId: "another-owner" });
    await mount({ draftScope });
    expect((screen.getByLabelText("备忘录") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "重试保存" })).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("saves edits made to a restored draft after reconciling the original write", async () => {
    const draftScope = createFillAnnotationDraftScope();
    const write = vi.fn().mockRejectedValueOnce(new FillAnnotationError("uncertain"))
      .mockResolvedValueOnce(result("离线前", 1));
    repository.createFillAnnotationWrite.mockReturnValueOnce(write)
      .mockReturnValueOnce(async () => result("重试前又编辑", 2));
    const original = await mount({ draftScope });
    changeMemo("离线前");
    await act(async () => { original.unmount(); });

    await mount({ draftScope });
    changeMemo("重试前又编辑");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试保存" })); });
    expect(repository.createFillAnnotationWrite.mock.calls[1]?.slice(1, 3)).toEqual([
      result("离线前", 1).snapshot, { body: "重试前又编辑", tags: [] },
    ]);
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });

  it("keeps the detached draft read-only after the trade revision changes", async () => {
    const draftScope = createFillAnnotationDraftScope();
    const write = vi.fn().mockRejectedValueOnce(new FillAnnotationError("uncertain"));
    repository.createFillAnnotationWrite.mockReturnValueOnce(write);
    const original = await mount({ draftScope });
    changeMemo("旧修订的备忘");
    await act(async () => { original.unmount(); });

    await mount({ draftScope, cycleRevision: 4 });
    const memo = screen.getByLabelText("备忘录") as HTMLTextAreaElement;
    expect(memo.value).toBe("旧修订的备忘");
    expect(memo.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "重试保存" })).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps validation visible for an invalid edit made while an older draft saves", async () => {
    let resolveFirst!: (value: ReturnType<typeof result>) => void;
    const first = new Promise<ReturnType<typeof result>>((resolve) => { resolveFirst = resolve; });
    repository.createFillAnnotationWrite.mockReturnValueOnce(() => first);
    await mount();
    changeMemo("有意义的备忘");
    await act(() => vi.advanceTimersByTimeAsync(600));
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "甲".repeat(41) } });
    await act(async () => { resolveFirst(result("有意义的备忘", 1)); });
    expect(screen.getByRole("alert").textContent).toContain("40");
    expect(screen.getByRole("status").textContent).not.toContain("等待保存");
  });

  it("keeps the local draft on a stale trade or annotation conflict", async () => {
    repository.createFillAnnotationWrite.mockReturnValueOnce(async () => { throw new FillAnnotationError("stale"); });
    await mount();
    changeMemo("待保存备忘");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByRole("alert").textContent).toContain("数据已更新");
    expect((screen.getByLabelText("备忘录") as HTMLTextAreaElement).value).toBe("待保存备忘");
    expect(repository.createFillAnnotationWrite).toHaveBeenCalledTimes(1);
  });

  it("refreshes the fill marker after returning to a memo saved while the editor was closed", async () => {
    const onSaved = vi.fn();
    repository.loadFillAnnotation.mockResolvedValueOnce(result("已保存的备忘", 3).snapshot);
    await mount({ onSaved });
    expect(onSaved).toHaveBeenCalledWith("42", note("已保存的备忘", 3));
    expect((screen.getByLabelText("备忘录") as HTMLTextAreaElement).value).toBe("已保存的备忘");
  });

  it("does not create a blank memo when the first edit is undone before autosave", async () => {
    await mount();
    changeMemo("临时内容");
    changeMemo("");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(repository.createFillAnnotationWrite).not.toHaveBeenCalled();
  });

  it("retries the same prepared versioned write after an uncertain network result", async () => {
    const write = vi.fn().mockRejectedValueOnce(new FillAnnotationError("uncertain"))
      .mockResolvedValueOnce(result("测试重试", 1));
    repository.createFillAnnotationWrite.mockReturnValueOnce(write);
    await mount();
    changeMemo("测试重试");
    await act(() => vi.advanceTimersByTimeAsync(600));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试保存" })); });
    expect(repository.createFillAnnotationWrite).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toContain("已保存");
  });

  it("leaves uncertain remaps read-only and prevents any save", async () => {
    const annotation = { ...note("原始笔记", 5), remap_status: "needs_confirmation" as const };
    repository.loadFillAnnotation.mockResolvedValueOnce({ ...blank, annotation, revision: 2 });
    await mount({ fill: { ...fill, annotation } });
    expect(screen.getByText(/需要确认/)).toBeTruthy();
    expect((screen.getByLabelText("备忘录") as HTMLTextAreaElement).readOnly).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(repository.createFillAnnotationWrite).not.toHaveBeenCalled();
  });

  it("rejects too many or overly long tags without attempting a save", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "甲".repeat(41) } });
    expect(screen.getByRole("alert").textContent).toContain("40");
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "一、二、三、四、五、六、七、八、九、十、十一" } });
    expect(screen.getByRole("alert").textContent).toContain("10");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(repository.createFillAnnotationWrite).not.toHaveBeenCalled();
  });
});
