# 模型服务商接口核验矩阵

核验日期：2026-07-26。本文只记录服务器适配器依赖的字段，不固定“最新模型”或价格。

| 服务商 | 服务器端点与认证 | 图像输入 | 结构化输出 | 用量字段 | 本项目适配 |
|---|---|---|---|---|---|
| OpenAI | Responses / Chat Completions；Bearer 认证 | 支持图像内容块 | JSON Schema / Structured Outputs | input/output token usage | OpenAI 兼容适配器；正式模型能力由后台配置 |
| Kimi / Moonshot | `POST /v1/chat/completions`；Bearer 认证 | 当前官方示例支持多模态内容 | `response_format` 支持 `json_object` 和 `json_schema` | `prompt_tokens`、`completion_tokens` | OpenAI 兼容适配器 |
| Anthropic | `POST /v1/messages`；`x-api-key` 与 `anthropic-version: 2023-06-01` | base64 或 URL；JPEG、PNG、GIF、WebP | 由提示词/工具定义后在服务器校验 | `input_tokens`、`output_tokens` | 独立 Messages 适配器 |
| Gemini | `generateContent`；`x-goog-api-key` | 小图可 inline data，较大或复用图用 Files API | `responseFormat.text.mimeType=application/json` 与 schema | `promptTokenCount`、`candidatesTokenCount` | 独立 Generate Content 适配器 |

核验来源（官方）：

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Kimi Chat Completion: https://platform.kimi.ai/docs/api/chat
- Anthropic Get Started / Messages: https://platform.claude.com/docs/en/get-started
- Anthropic API Primer / Vision: https://platform.claude.com/docs/en/claude_api_primer
- Gemini Structured Outputs: https://ai.google.dev/gemini-api/docs/generate-content/structured-output
- Gemini Image Understanding: https://ai.google.dev/gemini-api/docs/generate-content/image-understanding

## 适配原则

- 浏览器只调用本站网关，不接触这些端点或密钥。
- 适配器把不同响应统一为文本、可选结构化结果、输入/输出 Token、请求 ID 和结束原因。
- 服务商声称的结构化输出仍要经过本站字段校验、知识引用校验和第10版硬规则闸门。
- 模型名称、费用和上下文限制均由管理员配置，不写死在知识库前端。
- 本地模拟服务覆盖认证头、响应映射、超时和故障切换；开发测试不触发真实付费调用。
