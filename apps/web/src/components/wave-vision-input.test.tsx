import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveVisionInput } from "./wave-vision-input";
import type { AnalysisImageServices } from "@/lib/workbench/analysis-images";
const owner = "11111111-1111-4111-8111-111111111111";
const analysis = "22222222-2222-4222-8222-222222222222";
const imageId = "33333333-3333-4333-8333-333333333333";
const preview = { id: imageId, signedUrl: "https://project.supabase.co/storage/v1/object/sign/wave-analysis-images/private.png?token=synthetic", byteSize: 3, mimeType: "image/png" };
const file = () => new File(["png"], "private-name.png", { type: "image/png" });
const select = (files: File[]) => fireEvent.change(screen.getByLabelText("上传行情截图"), { target: { files } });
afterEach(cleanup);
function ports() {
  let invalidate: () => void = () => {};
  const verifyOwner = vi.fn().mockResolvedValue(undefined);
  const load = vi.fn().mockResolvedValue([preview]);
  const upload = vi.fn().mockResolvedValue(preview);
  const unsubscribe = vi.fn();
  const services: AnalysisImageServices = { verifyOwner, load, upload, watchOwner: (_owner, callback) => { invalidate = callback; return unsubscribe; } };
  return { services, verifyOwner, load, upload, unsubscribe, invalidate: () => invalidate() };
}
function Harness({ services, value, ensure = async () => ({ id: analysis }), onChange = vi.fn(), onBusyChange = vi.fn(), onReadyChange = vi.fn(), analysisId = analysis }: {
  services: AnalysisImageServices; value?: unknown; ensure?: () => Promise<{ id: string }>; onChange?: (ids: string[]) => void;
  onBusyChange?: (busy: boolean) => void; onReadyChange?: (ready: boolean) => void; analysisId?: string | null;
}) {
  const [ids, setIds] = useState(value);
  const [savedId, setSavedId] = useState(analysisId);
  return <WaveVisionInput actorId={owner} analysisId={savedId} step={4} instrument="BTCUSDT" timeframe="4小时" value={ids} ensureAnalysis={async () => { const saved = await ensure(); setSavedId(saved.id); return saved; }} onChange={(selected) => { onChange(selected); setIds(selected); }} onBusyChange={onBusyChange} onReadyChange={onReadyChange} services={services} />;
}

describe("current-step private screenshot input", () => {
  it("is optional with clear private/model/candidate limits, without querying an empty selection", () => {
    const f = ports(); render(<Harness services={f.services} />);
    expect(screen.getByText("行情截图（可选）")).toBeDefined();
    expect(screen.getByText(/不能代替精确 OHLC/)).toBeDefined(); expect(screen.getByText(/模型视觉能力由服务器核实/)).toBeDefined();
    expect(f.load).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("first persists a real new analysis, then uploads; adds only IDs and supports temporary preview", async () => {
    const f = ports(); const order: string[] = []; const onChange = vi.fn(); const busy = vi.fn();
    const ensure = vi.fn().mockImplementation(async () => { order.push("save"); return { id: analysis }; });
    f.upload.mockImplementation(async () => { order.push("upload"); return preview; });
    render(<Harness services={f.services} analysisId={null} ensure={ensure} onChange={onChange} onBusyChange={busy} />);
    select([file()]); await waitFor(() => expect(onChange).toHaveBeenCalledWith([imageId]));
    expect(order).toEqual(["save", "upload"]); expect(f.upload.mock.calls[0][0]).toEqual({ ownerId: owner, analysisId: analysis, step: 4, instrument: "BTCUSDT", timeframe: "4小时" });
    expect(JSON.stringify(onChange.mock.calls)).not.toContain("token="); expect(JSON.stringify(onChange.mock.calls)).not.toContain("private-name");
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    await screen.findByAltText("本步骤行情截图 1");
  });
  it.each([new File([], "empty", { type: "image/png" }), new File(["svg"], "image.svg", { type: "image/svg+xml" }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], "oversize.png", { type: "image/png" })])("rejects invalid files before saving/uploading", async (invalid) => {
    const f = ports(); const ensure = vi.fn(); render(<Harness services={f.services} ensure={ensure} />); select([invalid]);
    expect(screen.getByRole("alert").textContent).toContain("2 MiB"); expect(ensure).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("rejects more than three new screenshots as a whole, without partial uploads", () => {
    const f = ports(); render(<Harness services={f.services} />); select([file(), file(), file(), file()]);
    expect(screen.getByRole("alert").textContent).toContain("最多选择 3 张"); expect(f.upload).not.toHaveBeenCalled();
  });
  it("keeps failed save/upload/preview attempts out of selected references and shows a safe error", async () => {
    const f = ports(); const onChange = vi.fn(); f.upload.mockRejectedValue(new Error("image_preview_failed"));
    render(<Harness services={f.services} onChange={onChange} />); select([file()]);
    expect((await screen.findByRole("alert")).textContent).toContain("预览暂时不可用"); expect(onChange).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not auto-select partial success when a multi-file upload fails", async () => {
    const f = ports(); const onChange = vi.fn(); f.upload.mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error("image_upload_failed"));
    render(<Harness services={f.services} onChange={onChange} />); select([file(), file()]);
    await screen.findByRole("alert"); expect(onChange).not.toHaveBeenCalled();
  });
  it("removes only a reference, preserves cloud evidence, and offers reloading expired previews", async () => {
    const f = ports(); const onChange = vi.fn(); render(<Harness services={f.services} value={[imageId]} onChange={onChange} />);
    await screen.findByAltText("本步骤行情截图 1"); fireEvent.error(screen.getByRole("img")); expect(screen.getByRole("alert").textContent).toContain("过期");
    fireEvent.click(screen.getByRole("button", { name: "刷新截图预览" })); await waitFor(() => expect(f.load).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "移除截图 1" })); expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByText(/云端资料保留/)).toBeDefined(); expect(f.upload).not.toHaveBeenCalled();
  });
  it("fails closed on invalid IDs without showing hostile URLs or private source content", async () => {
    const f = ports(); const ready = vi.fn(); render(<Harness services={f.services} value={["javascript:private-source"]} onReadyChange={ready} />);
    expect(screen.getByRole("alert").textContent).toContain("截图引用无效"); expect(document.body.textContent).not.toContain("private-source"); expect(f.load).not.toHaveBeenCalled(); await waitFor(() => expect(ready).toHaveBeenCalledWith(false));
  });
  it("fails closed when saved screenshot metadata cannot be verified, but permits explicit clearing", async () => {
    const f = ports(); const ready = vi.fn(); const onChange = vi.fn(); f.load.mockRejectedValue(new Error("image_unavailable"));
    render(<Harness services={f.services} value={[imageId]} onReadyChange={ready} onChange={onChange} />);
    await screen.findByRole("alert"); expect(ready).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "清除本步骤截图" })); expect(onChange).toHaveBeenCalledWith([]);
  });
  it("invalidates an upload on account change before its acknowledgement, without restoring private previews", async () => {
    const f = ports(); const onChange = vi.fn(); let resolve!: (value: typeof preview) => void;
    f.upload.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<Harness services={f.services} onChange={onChange} />); select([file()]); await waitFor(() => expect(f.upload).toHaveBeenCalled());
    act(() => f.invalidate()); await act(async () => resolve(preview));
    expect(onChange).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull(); expect(screen.getByRole("alert").textContent).toContain("账号已变化");
  });
  it("invalidates an account change while first analysis save is pending", async () => {
    const f = ports(); let resolve!: (value: { id: string }) => void; const ensure = () => new Promise<{ id: string }>((done) => { resolve = done; });
    render(<Harness services={f.services} analysisId={null} ensure={ensure} />); select([file()]); await waitFor(() => expect(resolve).toBeTypeOf("function"));
    act(() => f.invalidate()); await act(async () => resolve({ id: analysis })); expect(f.upload).not.toHaveBeenCalled();
  });
  it("does not apply an old context's upload when instrument or timeframe changes", async () => {
    const f = ports(); const onChange = vi.fn(); let resolve!: (value: typeof preview) => void;
    f.upload.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const args = { actorId: owner, analysisId: analysis, step: 4, timeframe: "4小时", ensureAnalysis: async () => ({ id: analysis }), onChange, services: f.services };
    const view = render(<WaveVisionInput {...args} instrument="BTCUSDT" />); select([file()]); await waitFor(() => expect(f.upload).toHaveBeenCalled());
    view.rerender(<WaveVisionInput {...args} instrument="ETHUSDT" />); await act(async () => resolve(preview)); expect(onChange).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull();
  });
  it("does not apply private data after unmount and unsubscribes auth observation", async () => {
    const f = ports(); const onChange = vi.fn(); let resolve!: (value: typeof preview) => void;
    f.upload.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<Harness services={f.services} onChange={onChange} />); select([file()]); await waitFor(() => expect(f.upload).toHaveBeenCalled()); view.unmount();
    await act(async () => resolve(preview)); expect(onChange).not.toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("cannot upload or remove selection while an AI submission is in progress", async () => {
    const f = ports(); render(<WaveVisionInput actorId={owner} analysisId={analysis} step={4} instrument="BTCUSDT" timeframe="4小时" value={[imageId]} ensureAnalysis={async () => ({ id: analysis })} onChange={vi.fn()} services={f.services} disabled />);
    await screen.findByRole("img"); expect((screen.getByLabelText("上传行情截图") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "移除截图 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
