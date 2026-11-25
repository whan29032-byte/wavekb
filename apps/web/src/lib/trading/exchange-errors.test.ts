import { describe, expect, it } from "vitest";
import { exchangeErrorMessage } from "./exchange-errors";

describe("exchangeErrorMessage", () => {
  it.each([
    ["binance_1021", "Binance 拒绝了请求时间，请稍后重试；若持续出现请联系管理员检查服务器时间。"],
    ["binance_1022", "Binance 签名验证失败，请使用同一组 API Key 与 Secret Key 更新 API。"],
    ["binance_trading_permission_not_allowed", "该 Binance API 开启了交易权限。请关闭交易和提现权限，仅保留读取权限后更新 API。"],
    ["binance_rate_limited", "Binance 请求过于频繁，请稍后再同步。"],
    ["binance_multi_asset_not_supported", "暂不支持 Binance 多资产模式，请切换为单资产模式后重试。"],
  ])("translates %s into actionable guidance", (code, expected) => {
    expect(exchangeErrorMessage(code)).toBe(expected);
  });

  it("keeps fixed provider-data failures diagnosable without exposing upstream text", () => {
    expect(exchangeErrorMessage("binance_invalid_history_payload")).toBe(
      "Binance 返回了当前无法识别的数据格式；已保留上次完整数据，请联系管理员并提供诊断码：binance_invalid_history_payload。",
    );
  });

  it("does not echo unknown errors", () => {
    const unknown = "private upstream response with secret";
    const message = exchangeErrorMessage(unknown);
    expect(message).toBe("操作没有完成，请检查 API 权限与填写内容后重试。");
    expect(message).not.toContain(unknown);
  });
});
