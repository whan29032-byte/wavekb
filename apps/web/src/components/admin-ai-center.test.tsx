import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminAiCenter } from "./admin-ai-center";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps a loading state until gateway reads complete", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<AdminAiCenter />);
  expect(screen.getByText("正在连接 AI 网关")).toBeTruthy();
  expect(screen.queryByText("AI 网关尚未连接")).toBeNull();
});

it("resets the saved provider form after the asynchronous request and refreshes the list", async () => {
  let saved = false;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.method === "POST") saved = true;
    return { ok: true, json: async () => ({ providers: saved ? [{ id: "p1", name: "本地测试服务", adapter: "openai_compatible", base_url: "https://example.invalid", enabled: true }] : [] }) };
  }));
  render(<AdminAiCenter />);
  await screen.findByText("AI 网关已连接");
  fireEvent.change(screen.getByLabelText("服务商名称"), { target: { value: "本地测试服务" } });
  fireEvent.change(screen.getByLabelText("API 地址"), { target: { value: "https://example.invalid" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-only" } });
  fireEvent.click(screen.getByRole("button", { name: "测试并保存" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await screen.findByText("本地测试服务");
  expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
});
