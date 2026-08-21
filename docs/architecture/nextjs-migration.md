# WaveKB Next.js 全栈迁移架构

## 目标

在不停止现有网站、不复制生产数据的前提下，将浏览器全局脚本迁移到可测试的 Next.js App Router 架构。生产切流已经完成：Nginx 的 `/` 与 `/v1/` 分别转发到 Next.js 和网关；旧静态站冻结保留，只作为可恢复发布物和视觉/功能对照基准。

## 工作区

```text
apps/web                Next.js App Router 全栈应用
ai-gateway              现有 UID 登录、管理与 AI 网关
packages/domain         板块、帖子、验证与领域类型
packages/knowledge      从旧 HTML 抽出的 161 个知识条目
packages/ui             定制 shadcn/ui 基础组件
community               冻结保留的旧社区实现（回滚与对照）
assets                  原书图片与知识库资源
supabase                数据库迁移和 Edge Functions
```

所有工作区由根目录的 `pnpm-workspace.yaml` 和单一 `pnpm-lock.yaml` 管理。`apps/web` 使用 Next.js Server Components 读取公开内容，交互式发布器被隔离为 Client Component。

## 数据边界

- 新旧前端共用现有 `posts`、`post_images`、`profiles` 表和 `post-images` 存储桶。
- 新应用使用 publishable key 和用户 JWT，所有写操作继续由现有 RLS 约束。
- UID 登录仍由 `ai-gateway` 在服务端解析，浏览器和 Next.js 都不会获得用户邮箱映射或 service-role key。
- 发帖先写入不可见草稿，图片和元数据全部完成后才发布。失败会清理已上传文件和草稿行。
- 数据库迁移、生产密钥、用户上传内容不进入前端发布包。

## 路由兼容

首批新路由：

```text
/                              新应用入口
/login                         邮箱或 UID 登录
/knowledge                     可搜索的知识库入口
/knowledge/[id]                规则、图示与原书来源
/community/[board]             板块列表
/community/[board]/new         登录后发布
/community/post/[id]           帖子详情
/community/post/[id]/edit      作者编辑
/member/[uid]                  匿名可读公开主页；登录后开放社交动作
/member/profile                资料、头像、封面与铭牌管理
/friends                       UID 查找与好友请求处理
/messages                      私聊会话列表
/messages/[id]                 私聊消息与快捷表情
/workbench                     私人复盘、日记与草稿
/workbench/analysis/[id]       11 步波浪分析、规则、回撤与风险计算
/workbench/ai                  用户自带模型与密钥轮换
/workbench/entries/new         新建私人记录
/workbench/entries/[id]        编辑、软删除与公开副本
/mentors                       公开导师目录与进行中辅导入口
/mentors/[id]                  导师资料、方案与人工付款声明
/tutoring                      学员权益与历史会话
/tutoring/[id]                 双方消息与服务端周额度
/mentor/manage                 导师方案、收款核对与学员管理
/rewards                       积分钱包、签到、商城、排行与账本
/admin/users                   用户状态、权限、禁言与公开 UID
/admin/rewards                 商品、钱包、铭牌与兑换管理
/admin/directory               X 与 Discord 首页推荐管理
/admin/mentors                 导师、方案、收款方式与订单权益
/admin/audit                   不可删除的后台治理审计记录
/admin/ai                      AI 网关概览与平台备用供应商
```

逐项功能状态与生产验收证据见 [nextjs-feature-parity.md](nextjs-feature-parity.md)。

现有 `/#page=...`、`/#board=...` 和 `/#post=...` 入口只属于冻结的旧静态实现。正式域名已使用 Next 路由；旧静态目录不再承接新功能，也不会在 Next 页面中被当作生产入口。

知识数据由 `pnpm knowledge:extract` 从当前 `index.html` 的 `elliott-kb-data` 生成。提取脚本校验唯一 ID，并移除构建机绝对路径。Next 在构建期预生成全部 161 个详情页，原书图片仍由现有静态资源目录提供。

会员公开主页通过现有 `search_profile_by_uid`、`list_my_friendships` 和 `profile_follows` 读取，不复制用户资料。关注、好友请求、私聊、未读清理和资料编辑已迁移。头像在浏览器内裁切后上传，资料 RPC 成功后才安全清理旧文件。

交易工作台继续读取现有 `private_entries` 和私有 `private-entry-images` 存储桶。服务端只按当前 owner 查询并签发短期图片地址；保存失败会清理本次上传，移除记录沿用可恢复的软删除。公开发布先创建独立草稿并写入 `post_sources`，只复制标题、正文和显式新增的公开图片，`review_data` 与私密图片不会进入社区帖子。

导师目录继续读取现有导师、方案、订单、权益、会话和消息表。付款按 `create_manual_mentor_order` 创建价格快照，再由 `submit_mentor_payment_claim` 提交声明；只有导师本人通过 `review_mentor_payment_claim` 确认实际到账后，数据库才创建权益和专属会话。学员问题由 `send_mentor_message` 在服务端核验参与者、有效期和自然周额度，导师回复不消耗学员额度。导师管理 RPC 只返回当前导师本人名下的付款声明和学员，不因管理员身份扩大读取范围。

积分中心通过 `get_my_reward_center` 读取当前钱包、任务账本、商品和有效铭牌，并通过登录后可见的 `list_reward_leaderboard` 读取排行。签到、兑换和佩戴分别交给 `reward_daily_checkin`、`redeem_reward_product` 与 `equip_my_nameplate`；余额扣减、库存锁定、重复任务防护和限时所有权都在数据库事务与 RLS 内完成，浏览器只显示服务器结果。

后台布局先通过 Supabase 服务端会话确认当前资料是有效管理员，再显示治理页面。用户邮箱、账号状态和审计记录仍由现有 `ai-gateway` 使用 service-role RPC 返回；Next 只携带当前管理员 JWT 访问内网网关，并通过显式白名单代理用户概览、筛选、封禁、禁言、角色、UID 和审计接口。Next 应用及浏览器都不保存 service-role key，所有变更要求操作原因、二次确认并由数据库落审计记录。

后台积分模块通过现有 `admin_*` RPC 读取和修改商品、钱包、兑换与铭牌授权。商品只能新建、编辑或下架，不提供物理删除；积分扣减不能产生负余额；退款使用兑换 ID 作为唯一引用幂等返还；铭牌发放按用户和商品续期，撤销后由数据库重新同步有效样式。浏览器仍只持有公开 key 和当前管理员 JWT。

首页推荐继续通过内网网关规范 X 与 Discord 地址并读取公开元数据，Next 代理只放行目录的固定读写路径并限制请求体大小。导师后台使用管理员目录 RPC 原子保存导师与首个方案，其他方案、收款方式和订单更新继续受现有 RLS 约束。订单状态更新同时匹配原状态，避免并发覆盖；数据库触发器负责在支付时发放权益、在退款或取消时撤销权益。

## UI 约束

- 单一冷灰底色和蓝色主强调色，亮色与暗色跟随系统设置。
- 卡片统一使用 12px 圆角，表单使用 8px 圆角，按钮文字不换行。
- 页面默认无自动动效，交互只使用 hover、focus 和 active 反馈。
- 组件库代码由项目持有，Storybook 对共享组件执行可访问性检查。
- 表单具备明确标签、帮助文本、字段错误、加载状态和失败恢复提示。

## 当前部署状态

1. `wavekb-next-preview.service` 是历史沿用的服务名，实际承载正式 Next.js 生产流量，监听 `127.0.0.1:3100`。
2. `elliott-wave-gateway.service` 承载 `/v1/` 与认证/管理网关，监听 `127.0.0.1:8787`。
3. Nginx `location /` 全量转发 Next.js；没有启用中的 WaveKB 静态 `root/index` 入口。
4. 推送 `main` 后先完成测试、类型检查、Lint、生产构建和静态资源检查，再备份上一版本、原子切换软链接并执行生产 HTTPS 验收。
5. 正式验收包含桌面/移动公开路由、真实账号个人主页与悬浮好友/聊天拖拽，以及完整发帖生命周期；失败自动恢复 Next 与网关上一版本。
6. 旧静态目录继续冻结保留，在回滚观察期结束前不删除用户数据、上传文件或旧发布物。

## 完成定义

新应用不能因为“页面能打开”就视为迁移完成。每个功能需要领域测试、组件状态、Playwright 用户路径、移动端检查、权限验证和生产健康检查全部通过。发帖最终验收必须使用专用账号并在测试后清理内容和上传文件。
