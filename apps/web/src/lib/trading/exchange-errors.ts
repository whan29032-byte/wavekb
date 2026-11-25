const BINANCE_MESSAGES: Record<string, string> = {
  binance_1021: "Binance 拒绝了请求时间，请稍后重试；若持续出现请联系管理员检查服务器时间。",
  binance_1022: "Binance 签名验证失败，请使用同一组 API Key 与 Secret Key 更新 API。",
  binance_2014: "Binance API Key 格式无效，请重新复制并更新 API。",
  binance_2015: "Binance 拒绝了访问。请确认 API 仅有读取权限、IP 白名单包含本站服务器，然后更新 API。",
  binance_credentials_required: "请完整填写 Binance API Key 与 Secret Key。",
  binance_income_window_too_large: "交易历史数据量过大，已保留上次完整数据，请联系管理员分段导入。",
  binance_multi_asset_not_supported: "暂不支持 Binance 多资产模式，请切换为单资产模式后重试。",
  binance_non_usdt_product_not_supported: "目前仅支持 Binance USD-M 的 USDT 合约账户。",
  binance_provider_mismatch: "当前凭证与 Binance 连接类型不匹配，请重新选择交易平台。",
  binance_rate_limited: "Binance 请求过于频繁，请稍后再同步。",
  binance_read_only_ack_required: "请确认 Binance API 已关闭交易和提现权限。",
  binance_trading_permission_not_allowed: "该 Binance API 开启了交易权限。请关闭交易和提现权限，仅保留读取权限后更新 API。",
  binance_transfer_asset_not_supported: "当前账户包含非 USDT 资金划转，暂时无法生成可靠复盘。",
  binance_unavailable: "Binance 服务暂时不可用，已保留上次完整数据，请稍后再同步。",
};

const BINANCE_PROVIDER_DATA_ERRORS = new Set([
  "binance_invalid_asset",
  "binance_invalid_commission",
  "binance_invalid_commission_asset",
  "binance_invalid_connection_id",
  "binance_invalid_equity",
  "binance_invalid_history_cursor",
  "binance_invalid_history_payload",
  "binance_invalid_income",
  "binance_invalid_income_asset",
  "binance_invalid_income_symbol",
  "binance_invalid_income_time",
  "binance_invalid_income_type",
  "binance_invalid_order_id",
  "binance_invalid_position_side",
  "binance_invalid_price",
  "binance_invalid_quantity",
  "binance_invalid_realized_pnl",
  "binance_invalid_side",
  "binance_invalid_symbol",
  "binance_invalid_trade",
  "binance_invalid_trade_id",
  "binance_invalid_trade_time",
  "binance_invalid_trades",
  "binance_invalid_transaction_id",
  "binance_invalid_unrealized_pnl",
  "binance_invalid_wallet_balance",
  "binance_unknown_position_side",
  "binance_unknown_side",
]);

const GENERIC_EXCHANGE_ERROR = "操作没有完成，请检查 API 权限与填写内容后重试。";

export function exchangeErrorMessage(code: string): string {
  const knownMessage = BINANCE_MESSAGES[code];
  if (knownMessage) return knownMessage;
  if (BINANCE_PROVIDER_DATA_ERRORS.has(code)) {
    return `Binance 返回了当前无法识别的数据格式；已保留上次完整数据，请联系管理员并提供诊断码：${code}。`;
  }
  return GENERIC_EXCHANGE_ERROR;
}
