# 悠悠的宝宝｜Discord 档案机器人

一个科学侧 / 魔法侧双路线的 Discord 频道机器人。成员发言可积累经验并升级，也能通过中文斜杠命令查看或设置个人档案。

## 功能

- 发言每 60 秒最多获得一次 5–15 点经验，升级时自动提示。
- `/档案 [用户]`：生成 PNG 档案卡。
- `/设置档案 名称 咏唱`：设置能力名称或术式名，以及发动词或咏唱。
- `/选择路线 路线`：在科学侧能力者和魔法侧魔法师之间切换；每 7 天最多切换一次。
- `/绑定网站`：生成 10 分钟内有效、仅可使用一次的 WaveKB 账号绑定链接。
- `/网站账号`：私密显示已绑定网站账号的 UID、名称、头像、称号、名牌和积分，并同步已批准的普通角色。
- `/玩法帮助`：查看网站积分玩法、消耗规则和虚拟行情安全说明。
- `/签到`：领取与网站共享的每日签到奖励；网站或 Discord 任一端领取后，另一端不会重复发放。
- `/打工`：按当前科学侧或魔法侧完成阵营委托，每 4 小时一次、每日最多 4 次。
- `/技能抽奖`、`/技能图鉴`：使用当前阵营独立技能池，支持 100 积分单抽、900 积分十连、重复补偿和双层保底。
- `/行情`、`/押注`：参与三个主题虚拟指数的每日涨跌玩法；21:00 停盘、22:00 结算，每日最多投入 500 社区积分。
- `/宠物`：查看商店、每日免费领养、购买与孵化宠物蛋、查看收藏、改名和选择出战宠物。
- 新成员加入后会在入学登记处收到欢迎消息，并可通过按钮选择科学侧或魔法侧。
- 科学侧使用浅色蓝白科技背景；魔法侧使用深蓝星空术式背景。
- 按总经验计算服务器内真实排名；同经验成员并列。
- SQLite 按服务器隔离并持久保存档案、等级、经验和冷却时间，重启不会丢失。

## 环境要求

- Node.js 22 或更高版本
- Windows PowerShell（其他平台也可使用等价的 `npm` 命令）
- Discord 应用与 Bot Token

## 安装

在项目目录运行：

```powershell
npm.cmd install
Copy-Item .env.example .env
```

打开 `.env`，填写：

```env
TOKEN=你的_Bot_Token
CLIENT_ID=1545138494131666964
GUILD_ID=
WELCOME_CHANNEL_ID=1545734710888632411
THEME_GUILD_ID=
SCIENCE_ROLE_ID=
MAGIC_ROLE_ID=
SCIENCE_GROWTH_ROLE_IDS=
MAGIC_GROWTH_ROLE_IDS=
WEBSITE_API_URL=
WEBSITE_PUBLIC_URL=
WEBSITE_BOT_API_SECRET=
WEBSITE_GUILD_ID=
WEBSITE_LINKED_ROLE_ID=
WEBSITE_TITLE_ROLE_MAP={}
PROXY_URL=
DATABASE_PATH=data/profile-bot.db
```

- `TOKEN`：在 Discord Developer Portal 的 **Bot** 页面获取。Token 只放在本地 `.env`。
- `CLIENT_ID`：当前应用“悠悠的宝宝”的 Application ID，已预填。
- `GUILD_ID`：可选。开发时填写测试服务器 ID，命令会立即部署到该服务器；留空则部署为全局命令。
- `WELCOME_CHANNEL_ID`：可选。发送新成员欢迎与阵营选择按钮的文字频道；留空时默认使用 `1545734710888632411`（📜・入学登记处）。
- `THEME_GUILD_ID`、`SCIENCE_ROLE_ID`、`MAGIC_ROLE_ID`：可选的路线身份角色同步配置。三项必须全部留空或全部填写，且两个角色 ID 不能相同。主题角色创建完成后，把 CLI 输出的 `esperRoleId` 和 `magicianRoleId` 填入对应项。
- `SCIENCE_GROWTH_ROLE_IDS`、`MAGIC_GROWTH_ROLE_IDS`：可选的双路线成长角色配置；必须同时填写，每项按阶段 0–5 填写六个逗号分隔的不同角色 ID，且不得与身份角色 ID 重复。
- `WEBSITE_API_URL`、`WEBSITE_BOT_API_SECRET`、`WEBSITE_GUILD_ID`：可选的网站接入配置，三项必须同时填写。API 地址只填写机器人实际请求的 HTTP(S) 来源；密钥必须与网站服务端的 `DISCORD_BOT_API_SECRET` 完全一致、至少 32 个 UTF-8 字节；服务器 ID 必须与网站服务端允许的服务器一致。
- `WEBSITE_PUBLIC_URL`：可选的公开 HTTP(S) 来源，留空时沿用 `WEBSITE_API_URL`。内网 API 与用户公开站点不同时必须填写，例如 API 使用 `http://wavekb-internal:3100`、公开来源使用 `https://wavekb.com`；机器人只接受公开来源返回的绑定链接。
- `WEBSITE_LINKED_ROLE_ID`：可选。网站账号已绑定成员获得的普通角色 ID；不得与科学侧 / 魔法侧身份角色或任一成长角色重叠。
- `WEBSITE_TITLE_ROLE_MAP`：可选。网站称号到 Discord 普通角色 ID 的 JSON 对象，例如 `{"风纪委员":"123456789012345678"}`。角色 ID 不得重复，也不得与绑定角色、身份角色或任一成长角色相同。
- `PROXY_URL`：可选。无法直连 Discord 时填写 HTTP(S) 代理，例如 `http://127.0.0.1:7897`。
- `DATABASE_PATH`：可选，默认数据库位于 `data/profile-bot.db`。

如果 Token 曾发送到聊天、截图或提交到 Git，请立即在 Developer Portal 重置；重置后旧 Token 会失效。

## 部署命令并启动

首次运行或修改斜杠命令后执行：

```powershell
npm.cmd run deploy
npm.cmd start
```

填写 `GUILD_ID` 时，命令通常会很快出现在该测试服务器；留空部署为全局命令时，Discord 可能需要一段时间完成传播。

### 启用 WaveKB 网站账号绑定

网站是账号与积分的唯一数据源；Discord 本地经验、等级和科学侧 / 魔法侧成长体系仍独立保存，不会覆盖网站积分。

按以下顺序上线，避免机器人先调用尚未准备好的接口：

1. 在网站数据库应用 Discord 账号绑定迁移。
2. 使用 `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` 生成共享密钥；在网站服务端设置 `SUPABASE_SERVICE_ROLE_KEY`、`DISCORD_BOT_API_SECRET`、`DISCORD_BOT_GUILD_ID` 和 `DISCORD_LINK_PUBLIC_ORIGIN`，然后部署网站。
3. 在机器人 `.env` 中填写上述 `WEBSITE_*` 配置，其中机器人与网站的共享密钥必须相同。轮换时先更新网站和机器人两端的受保护环境变量，再重启两项服务；不要把旧值或新值写进日志、聊天或仓库。
4. 运行 `npm.cmd run deploy` 发布网站绑定、积分玩法和宠物命令，再重启机器人。

积分余额与流水只保存在 WaveKB；机器人本地 SQLite 仍只保存 Discord 经验、等级和阵营档案。所有积分写操作都使用 Discord interaction ID 幂等提交，超时后不会自行生成新的请求号重试。虚拟行情只使用不可购买、不可转账、不可提现的社区积分，不对应真实证券、币价或法币。

绑定链接只保存不可逆摘要、10 分钟过期且只能兑换一次。网站接口只向机器人返回公开档案字段，不返回邮箱、登录方式或其他认证数据。角色同步严格限制在 `WEBSITE_LINKED_ROLE_ID` 和 `WEBSITE_TITLE_ROLE_MAP` 声明的普通角色；每次写入前都会拒绝缺失、`@everyone`、托管、跨服务器、含管理/审核权限或不低于机器人最高角色的目标，且不会修改其他无关角色。

机器人上线后会显示：

```text
悠悠的宝宝 已上线
```

按 `Ctrl+C` 可安全关闭机器人和数据库连接。

## 邀请机器人所需权限

在 Developer Portal 的 **OAuth2 → URL Generator** 中选择：

- Scopes：`bot`、`applications.commands`
- Bot Permissions：`View Channels`、`Send Messages`、`Embed Links`、`Attach Files`、`Manage Roles`

`Manage Roles` 是路线身份、成长角色和已批准网站普通角色自动同步的永久运行权限；请始终把“悠悠的宝宝”机器人角色放在所有由机器人管理的角色之上。日常档案与网站绑定功能不需要授予 `Administrator`。机器人启用 `Guilds`、`GuildMessages` 与 `GuildMembers` intents；Developer Portal 中必须开启 **Server Members Intent**。机器人不读取消息正文，因此无需开启 `Message Content Intent`。

如果要由安全主题 CLI 实施服务器装饰，实施期间还需要：

- `Manage Guild`：更新服务器头像、横幅和邀请背景。
- `Manage Channels`：更新已批准频道的名称与说明。
- `Manage Roles`：创建路线角色并更新成长角色的名称、颜色和图标。
- `Embed Links`：发送入学登记导航消息。

请把“悠悠的宝宝”机器人角色放在所有要编辑的普通角色上方，但不要移动或尝试修改 `Server Booster`、集成角色等托管角色。即使实施主题，也不得授予 `Administrator`。

## 数据与素材

- 数据库：`data/profile-bot.db`（已被 Git 忽略）
- 科学侧背景：`assets/bg-esper.png`
- 魔法侧背景：`assets/bg-magician.png`
- 服务器主题主视觉：`assets/theme/server-icon.png`、`server-banner.png`、`invite-splash.png`
- 路线与成长角色图标：`assets/theme/role-icons/`

经验冷却和路线切换冷却均保存在数据库中。删除数据库会清空所有成员档案和进度，请先备份。

从旧版全局用户表首次升级时，机器人会自动迁移数据库。旧资料会保存在专用的
`__legacy_global__` 隔离区，不会泄漏到任何真实服务器；成员在各服务器发言或使用命令后，
会分别建立该服务器自己的档案、经验、排名和冷却记录。

## 学园都市主题的安全发布

主题工具固定只管理服务器 `1545731927733047306` 的已批准频道与角色。默认无参数只显示帮助，不写入 Discord；每个写入阶段都必须带完全一致的 `--confirm-guild`，并在开始前重新抓取快照、校验漂移、生成本地备份。任何阶段首个失败都会停止，不会自动继续下一阶段。

先执行只读检查：

```powershell
npm.cmd run theme:snapshot
npm.cmd run theme:dry-run
```

确认 dry-run 只列出预期目标后，逐阶段执行；不要把这些命令合并成无人值守的批量脚本：

```powershell
node scripts/manage-server-theme.js apply identity-roles --confirm-guild 1545731927733047306
node scripts/manage-server-theme.js apply magic-growth-roles --confirm-guild 1545731927733047306
node scripts/manage-server-theme.js apply channels --confirm-guild 1545731927733047306
node scripts/manage-server-theme.js apply growth-roles --confirm-guild 1545731927733047306
node scripts/manage-server-theme.js apply guild-assets --confirm-guild 1545731927733047306
node scripts/manage-server-theme.js apply welcome --confirm-guild 1545731927733047306
```

`dry-run` 会同时列出机器人有效权限、频道覆盖、服务器功能标记和角色层级阻挡项。任何目标阶段仍有 blocker 时，CLI 会在生成写入前备份之前拒绝执行；不要通过授予 `Administrator` 绕过检查。成长角色阶段要求机器人角色位于七个目标角色之上，主视觉阶段要求 `Manage Guild`。

`identity-roles` 输出三个身份角色 ID，`magic-growth-roles` 输出六个魔法成长角色 ID。将身份角色 ID 写入本地 `.env` 的 `SCIENCE_ROLE_ID`、`MAGIC_ROLE_ID`，并把现有六个科学成长角色 ID 与新建六个魔法成长角色 ID 分别按阶段 0–5 写入 `SCIENCE_GROWTH_ROLE_IDS`、`MAGIC_GROWTH_ROLE_IDS`；`THEME_GUILD_ID` 设为 `1545731927733047306`，然后安全重启机器人。重复执行 `/选择路线` 会幂等修复身份和成长角色；两条路线权限完全相同，只影响身份展示。

每次实施前快照位于 `data/server-theme-backups/<时间>-before/`，其中也会保存目标角色原有图标；欢迎消息 ID 与实施后的角色图标哈希位于 `data/server-theme-state.json`，并以原子替换方式写入。这些文件均被 Git 忽略。重复执行会按哈希修复错误或过期的角色图标；欢迎阶段会优先更新已记录消息，即使状态文件丢失或消息 ID 失效，也会分页查找机器人自己发送的主题标记，避免重复发送。

完成全部阶段后，用最初的快照验证频道 ID、父分类、排序、权限覆盖、既有角色权限与层级未发生漂移：

```powershell
node scripts/manage-server-theme.js verify --before <实施前快照>
```

如需回滚，把 `<快照>` 替换为对应备份中的 `manifest.json`：

```powershell
node scripts/manage-server-theme.js rollback --snapshot <快照> --confirm-guild 1545731927733047306
```

回滚只恢复已批准频道的名称/说明、成长角色的名称/颜色和服务器主视觉；不会删除成员数据、移动频道、覆盖权限或修改无关角色。新建的路线身份角色会保留，便于机器人继续同步。

## 开发验证

```powershell
npm.cmd test
npm.cmd run check
```

- `test`：运行经验、数据库、命令、双主题卡片、路线与网站角色同步、网站客户端、主题安全管理器、视觉素材和 Discord 事件测试。
- `check`：检查全部运行时、命令和主题脚本的 JavaScript 语法。

测试生成的临时样张位于 `test-output/`，该目录不会提交到 Git。

## 安全说明

- `.env` 已加入 `.gitignore`，不要使用 `git add -f .env`。
- 不要在日志、聊天、截图或 Issue 中公开 Token。
- `WEBSITE_BOT_API_SECRET` 只允许出现在机器人和网站服务端环境变量中，且必须至少有 32 个 UTF-8 字节；不要写进网页前端、日志或仓库。疑似泄露时立即生成新值、同步轮换两端并重启服务。
- 不要把数据库文件提交到公开仓库。
- 机器人只应获得上述最小权限。
