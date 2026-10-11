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
    return { ok: true, json: async () => ({ provider: init?.method === "POST" ? { id: "p1" } : undefined, providers: saved ? [{ id: "p1", name: "本地测试服务", adapter: "openai_compatible", base_url: "https://example.invalid", enabled: true }] : [] }) };
  }));
  render(<AdminAiCenter />);
  await screen.findByText("AI 网关已连接");
  fireEvent.change(screen.getByLabelText("服务商名称"), { target: { value: "本地测试服务" } });
  fireEvent.change(screen.getByLabelText("API 地址"), { target: { value: "https://example.invalid" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-only" } });
  fireEvent.click(screen.getByRole("button", { name: "安全保存" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await screen.findByText("本地测试服务");
  expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("status").textContent).toContain("尚未验证模型调用");
});

const fillAndSave = () => {
  fireEvent.change(screen.getByLabelText("服务商名称"), { target: { value: "我的服务商" } });
  fireEvent.change(screen.getByLabelText("API 地址"), { target: { value: "https://api.deepseek.com/v1" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "synthetic-key-not-a-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "安全保存" }));
};
const readPayload = { calls_today: 0, tokens_today: 0, cost_today: 0, failed_today: 0, review_queue: 0, providers: [] };
const ok = (body: unknown) => new Response(JSON.stringify(body));

it("only claims the management endpoint is connected, not complete model/key/route readiness", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok(readPayload)));
  render(<AdminAiCenter />); await screen.findByText("AI 网关已连接");
  expect(screen.getByText(/仅证明后台管理接口可读取/).textContent).toContain("不代表模型、密钥、任务路由或会员 AI 已配置");
  expect(screen.queryByText(/均可用/)).toBeNull(); expect(screen.queryByRole("button", { name: "测试并保存" })).toBeNull();
  expect(screen.getByText(/不会发送模型测试请求/)).toBeDefined();
  expect(screen.getByText(/deepseek-flash 是模型名，不填写在这里/)).toBeDefined();
  expect((screen.getByLabelText("API 地址") as HTMLInputElement).placeholder).toBe("https://api.deepseek.com/v1");
});

it.each([
  ["invalid_provider_url", "API 地址格式无效"],
  ["provider_host_not_allowed", "主机尚未获网站允许"],
  ["provider_name_conflict", "已有同名服务商"],
  ["provider_save_failed", "未能安全保存"],
  ["invalid_request", "名称或适配器无效"],
  ["invalid_api_key", "API Key 不能为空"],
  ["authentication_required", "登录状态已失效"],
  ["admin_required", "没有 AI 后台管理权限"],
])("explains the fixed safe error %s in Chinese without exposing the raw code", async (code, text) => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "POST" ? new Response(JSON.stringify({ error: code }), { status: 400 }) : ok(readPayload)));
  render(<AdminAiCenter />); await screen.findByText("AI 网关已连接"); fillAndSave();
  const alert = await screen.findByRole("alert"); expect(alert.textContent).toContain(text); expect(alert.textContent).not.toContain(code);
  expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("我的服务商");
});

it.each(["provider_host_not_allowed: https://user:secret@example.test?key=private", "raw exception with api_key=private-key /etc/private/gateway.env", "<script>private-value</script>"])("does not echo an unknown upstream error or substring-match a safe code", async (raw) => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "POST" ? new Response(JSON.stringify({ error: raw }), { status: 500 }) : ok(readPayload)));
  render(<AdminAiCenter />); await screen.findByText("AI 网关已连接"); fillAndSave();
  const alert = await screen.findByRole("alert"); expect(alert.textContent).toContain("保存结果暂时无法确认"); expect(alert.textContent).not.toContain(raw); expect(document.body.textContent).not.toContain("private-key");
});

it("keeps a successful save distinct from a list refresh failure and retries reads without another POST", async () => {
  let saved = false; let refreshAllowed = false;
  const provider = { id: "p1", name: "我的服务商", adapter: "openai_compatible", base_url: "https://api.deepseek.com/v1", enabled: true, last_four: "test" };
  const fetcher = vi.fn(async (_url, init) => {
    if (init?.method === "POST") { saved = true; return ok({ provider }); }
    if (saved && !refreshAllowed) return new Response(JSON.stringify({ error: "raw-key-internal-error" }), { status: 503 });
    return ok({ ...readPayload, providers: saved ? [provider] : [] });
  });
  vi.stubGlobal("fetch", fetcher); render(<AdminAiCenter />); await screen.findByText("AI 网关已连接"); fillAndSave();
  const alert = await screen.findByRole("alert"); expect(alert.textContent).toContain("已成功保存，但后台列表刷新失败"); expect(alert.textContent).not.toContain("raw-key");
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe(""); expect((screen.getByLabelText("服务商名称") as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("status").textContent).toContain("已安全保存");
  refreshAllowed = true; fireEvent.click(screen.getByRole("button", { name: "刷新后台信息" })); await screen.findByText("我的服务商");
  expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1); expect(screen.queryByRole("alert")).toBeNull();
});

it("does not claim a confirmed save or clear a key when its success receipt is missing", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => ok(init?.method === "POST" ? {} : readPayload)));
  render(<AdminAiCenter />); await screen.findByText("AI 网关已连接"); fillAndSave();
  expect((await screen.findByRole("alert")).textContent).toContain("保存结果暂时无法确认");
  expect(screen.queryByRole("status")).toBeNull(); expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("synthetic-key-not-a-secret");
});

it("does not echo an initial read error containing a secret or provider URL", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "secret-key https://private.example/password" }), { status: 500 })));
  render(<AdminAiCenter />); const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("后台信息暂时无法读取"); expect(document.body.textContent).not.toContain("secret-key"); expect(document.body.textContent).not.toContain("private.example");
});
