# TradeX 实时行情：预发布交接

这是两个部署产物，均为本地交付，尚未对会员开放。不要只部署 WaveKB 页面而不部署图表模块。

## 部署到验收环境

1. 在独立的 TradeX 源码仓库，从干净提交运行 `python scripts/build_web.py --wavekb --release --parent-origin https://<WaveKB预发布站> --output <新空目录>`。只把该静态输出部署到独立 HTTPS 图表来源，不运行 TradeX 桌面服务器。启用 `_headers` 中的 `frame-ancestors` 等安全头（或在对应托管服务配置同值）。真实验收阶段还应由预发布环境限制直接访问；`frame-ancestors` 不保护直接访问。
2. 确认 `wavekb-market.html`、`SOURCE.txt`、`SOURCE.zip`、`LICENSE`、`NOTICE` 和 `licenses/NOTICE-vela.txt` 都由该图表来源提供。切勿上传站点配置、`.env`、会话、账户记录或 API 密钥。
3. 在 WaveKB 预发布的服务端设置 `WORKBENCH_LIVE_MARKET_ORIGIN` 为上述图表的纯 HTTPS 来源，`WORKBENCH_LIVE_MARKET_ENABLED=true`、`WORKBENCH_LIVE_MARKET_PILOT_UIDS=33333`、`WORKBENCH_LIVE_MARKET_PUBLIC_ENABLED=false`。使用现有经服务端验证的成交图与分享权限；不会自动修改现有权限。
4. 用隔离的预发布会话验证币安真实成交、重合点、备注保存、遮隐预览，以及发到测试社区的快照。验收测试可使用 `TRADING_TRADEX_ACCEPTANCE=1`、`TRADING_LIVE_ACCEPTANCE=1`、`PLAYWRIGHT_BASE_URL` 与 CI 已配置的验收登录凭据、授权测试周期 ID `E2E_PILOT_BINANCE_TRADE_ID`，执行 `pnpm --filter @wavekb/web test:e2e e2e/trading-workbench.spec.ts`。只在专用测试社区发布样例。用访客会话检查实际快照 JSON；登录后修改原备注时，原快照不能改变。验证完毕前不要打开全员开关。

## 本地复查

用 `--parent-origin https://app.wavekb.test` 打包一个本地输出，传给 `node apps/web/scripts/verify-tradex-frame.mjs <chart-build>`；可用 `TRADING_TEST_RECONNECT=1` 做强制重连。它经独立 Chromium 加载真实行情，成交点是合成测试数据，不读取真实会员账户。

公网发布前仍需确认行情展示许可、面向访问区域的 Binance 连通性、iOS 真机和实际授权交易的验收结果。紧急回滚可直接设 `WORKBENCH_LIVE_MARKET_ENABLED=false`，不禁用原历史复盘或公开快照。
