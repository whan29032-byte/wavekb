import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AiConnections } from "./ai-connections";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the personal model form separate from the member-only Hermes service", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ connections: [] })));
  vi.stubGlobal("fetch", fetcher); render(<AiConnections />);
  await screen.findByText(/尚未连接模型/);
  expect(screen.getByRole("heading", { name: "自带 Key 模型接口" })).toBeDefined();
  expect(screen.getByText(/与会员专属 Hermes 分开/)).toBeDefined();
  expect(screen.queryByRole("option", { name: /Hermes/ })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("selects and submits the current official DeepSeek Flash preset through the real form", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ connections: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ connection: { id: "new-deepseek" } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [] })));
  vi.stubGlobal("fetch", fetcher); render(<AiConnections />); await screen.findByText(/尚未连接模型/);
  fireEvent.change(screen.getByLabelText("API 服务商"), { target: { value: "deepseek" } });
  expect((screen.getByLabelText("API 地址") as HTMLInputElement).value).toBe("https://api.deepseek.com");
  expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe("deepseek-flash");
  fireEvent.change(screen.getByLabelText("接口名称"), { target: { value: "我的 DeepSeek" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "synthetic-not-a-real-key" } });
  fireEvent.submit(screen.getByLabelText("接口名称").closest("form")!);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(fetcher.mock.calls[1][0]).toBe("/api/ai/user/ai-connections");
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toMatchObject({ adapter: "openai_compatible", base_url: "https://api.deepseek.com", model_name: "deepseek-flash" });
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
});

it("does not rewrite an already saved user's model when choosing the new preset", async () => {
  const storedModel = "deepseek-v4-flash";
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ connections: [{ id: "existing-deepseek", label: "已保存 DeepSeek", adapter: "openai_compatible", base_url: "https://api.deepseek.com", model_name: storedModel, max_output_tokens: 4096, temperature: 0.2, enabled: true, is_default: true, secret_mask: "***" }] })));
  vi.stubGlobal("fetch", fetcher); render(<AiConnections />); await screen.findByRole("heading", { name: "已保存 DeepSeek" });
  fireEvent.change(screen.getByLabelText("API 服务商"), { target: { value: "deepseek" } });
  expect((screen.getByLabelText("模型名称") as HTMLInputElement).value).toBe("deepseek-flash");
  expect(screen.getByText(storedModel)).toBeDefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});

it("resets the captured form and refreshes the saved connection after an asynchronous success", async () => {
  let completeSave!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [] })))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { completeSave = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [{ id: "offline", label: "新连接", adapter: "openai_compatible", base_url: "https://example.test/v1", model_name: "test-model", max_output_tokens: 4096, temperature: 0.2, enabled: true, is_default: true, secret_mask: "***" }] })));
  vi.stubGlobal("fetch", fetcher);
  render(<AiConnections />);
  await screen.findByText(/尚未连接模型/);
  fireEvent.change(screen.getByLabelText("接口名称"), { target: { value: "新连接" } });
  fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "test-model" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "offline-not-a-key" } });
  fireEvent.submit(screen.getByLabelText("接口名称").closest("form")!);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => completeSave(new Response(JSON.stringify({ connection: { id: "offline" } }))));
  await screen.findByRole("heading", { name: "新连接" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("接口名称") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("alert")).toBeNull();
});
