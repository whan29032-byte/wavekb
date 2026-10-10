import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AiConnections } from "./ai-connections";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
