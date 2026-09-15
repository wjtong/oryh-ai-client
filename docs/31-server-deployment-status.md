# 多用户服务器版部署状态与交付缺口

更新：2026-09-15。分支：`codex/multi-tenant-server`。用户已授权推进测试部署。

**当前未部署完整服务器版，也还不是可以交付用户使用的发布候选。** 已完成的主要是隔离原型、OAuth/MCP 接入组件及原生协议边界测试。不能把 Docker 探针成功或脚本化模型测试成功称为应用部署成功；客户端仍有接线与业务功能需要完成。

## 服务端复查：原 HTTPS 阻塞已解除

2026-09-15 重新检查 `https://calwbiz-new.banff-tech.com`：

- TLS 证书验证与 OAuth/MCP 公开元数据预检通过；HTTP 返回 308 跳转 HTTPS。
- 未登录 POST `/mcp` 返回 401，并指向正确的 HTTPS protected-resource 元数据；未登录 `/api/v1/auth/me` 返回 401。
- `/oauth/revoke` 对不存在的测试 token 返回 200 空响应，符合已部署的撤销接口契约；没有撤销用户现有授权。
- 使用用户提供的测试账号，在浏览器中成功登录 ORYH 控制台，页面显示正确企业及用户。未修改业务记录。

[本次公开元数据证据](evidence/2026-09-15-deployment-preflight.json)。9 月 14 日默认自签名证书的失败记录保留为历史证据，不再作为当前阻塞。

这些检查不代替客户端 OAuth 授权码回调、真实 MCP prompts/resources、模型调用及多身份业务验收。客户端部署目标和入口域名仍需确定；本次未修改远端部署。

## 服务端部署要求与当前状态

1. HTTPS 证书及域名匹配：本次验证已通过。
2. 部署包含最新 MCP/Skills 及 OAuth 撤销接口的版本。本次检查的 ORYH main 为 `d8a3f9fb73643f28125e48323553cf9f98b158ff`，已包含 `POST /oauth/revoke`；不需要再重复开发同一接口。
3. 对外 HTTPS issuer / MCP resource 一致性：本次验证已通过。MCP 带授权的实际流式响应仍待客户端 OAuth 联调。
4. 为客户端入口准备 HTTPS 域名。按当前方案，还需要 owner 子域路由及相应 DNS/TLS；确定实际部署域名后，客户端元数据地址和 `/oryh/auth/callback` 才能固定。不要向部署脚本提交用户密码。
5. 提供隔离的测试账号/tenant 与测试业务数据，覆盖同 tenant 两用户、不同 tenant，以及普通用户和审批角色。使用浏览器 OAuth 登录，不把凭据加入 Skills、Session 或脚本执行环境。

当前源码审阅未发现“必须重新开发 MCP 或基础 OAuth”才能继续的问题。但必须在实际部署版本上通过登录、刷新、撤销、越权拒绝与业务写入测试，不能以源码存在代替接口可用。

## 客户端尚需完成的工作

| 工作 | 当前真实状态 | 完成依据 |
| --- | --- | --- |
| 原生浏览器会话 | 原生 SessionController + Gateway + 固定 preset 的 HTTP 创建、提示、查询、撤销拒绝已集成测试；尚未发布部署 Profile | 登录后实际 New Session、恢复、分叉、模型对话、刷新恢复均通过 |
| 登录与 owner Host 路由 | PKCE 登录、runtime pool、代理分别已测试；生产转接未贯通 | 浏览器租约绑定 owner/generation/grant；注销中断连接；同用户其他登录不误伤 |
| 原生 preset 与凭据 | 只读业务能力已可经原生 standing preset 装载；用户模型配置与多登录授权池尚未接通 | 固定受信插件组合，凭据按 owner 隔离，执行容器无法读取 |
| 完整业务能力 | 服务器原型仅查询项目、本人待办、费用；桌面功能仍在 | ORYH UI/Remote 使用可信运行时；工时、项目等编辑、保存与审批由同一受控操作执行 |
| 写入与正式确认 | 当前服务器工具拒绝写入 | 原生确认记录绑定身份、参数、版本与代次；重试不重复写；注销/撤权使确认失效 |
| 附件和特殊通道 | Gateway invoke/stream 之外仍有 Fetch 和 `$events` | 每个入口在真实认证代理下验证跨用户拒绝、注销中断和下载行为 |
| 发布镜像与运维 | 有 Docker 隔离探针；无完整应用发布镜像 | 固定输入构建、真实 Profile 启动、持久化卷、健康检查、资源限制、备份恢复及回滚 |
| 端到端验收 | 合成身份与脚本化模型测试通过 | 真实 HTTPS OAuth、MCP、模型、业务保存/审批、多人并发和重启恢复 |

**修复 HTTPS 不会自动补齐这些客户端缺口。** 后续应以“登录 → 原生会话 → 业务表单 → 正式确认 → 服务端回读”的完整链路作为交付单位，避免再次以单个原型批次作为部署完成依据。

## 2026-09-14 历史验证与复查命令

- 服务器实验包完整测试：105 项通过。
- 随后的固定 preset 归属校验和部署预检增量测试：5 项通过（含 2 项新预检测试）；未把分次执行描述为一次完整 107 项执行。
- 编译通过；真实 Gateway HTTP RPC 与 WebSocket mux 的拒绝已验证。
- Docker 四个合成身份的隔离、旧 generation 和已撤销授权拒绝探针通过，测试容器/卷已清理。不是完整应用容器部署。
- 当日 ORYH HTTPS 预检：失败；此问题已于 9 月 15 日复查关闭，历史[证据](evidence/2026-09-14-deployment-preflight.json)。

无凭据的公开元数据复查：

```sh
pnpm server:preflight https://calwbiz-new.banff-tech.com
```

该命令检查 HTTPS、固定 issuer/endpoints、PKCE、刷新/撤销发现信息及 MCP resource。失败返回非零状态；拒绝重定向，不发送账号凭据。预检成功只表示公开元数据合约通过，不代表实际 OAuth、业务写入或多用户隔离验收已完成。

## 2026-09-15 客户端实现与验证

新增外部 `native-binding` / `native-preset` 插件入口。可信 owner 能力决定原生 Workspace 与固定 preset；Gateway 对正在运行及落盘的 Session 验证归属。撤销授权会阻止后续请求并取消当前 Host 中的模型回合；Host 的完整回收仍由 supervisor 负责。

业务工具组合同时用于原有 Agent 工厂和原生 preset。修复“preset 层 skill-only 限制导致继承到 Agent 的业务工具也被隐藏”的问题；固定 preset 在每次模型回合前检查完整工具目录，发现未授权工具即拒绝运行，执行 guard 继续保留。

通过实际公共包的 SessionController、Connection、Gateway、附件/上传服务、原生默认模型与持久化存储完成 HTTP 集成测试：创建会话、发送消息、项目查询、回复、拒绝其他路径/Session，以及注销后的请求拒绝。额外覆盖不同目录的落盘会话拒绝。测试使用合成 OAuth/MCP 与脚本化模型，不声称已完成真实业务端到端调用；正式业务写入仍未开放。

服务器实验测试完整 110 项通过；随后新增落盘会话断言的 11 项 Agent 集成回归通过。编译通过。未修改 Harness 私有实现，未重新建立聊天协议。当前绑定是单授权 generation 的构件，不能作为同用户多个浏览器授权池直接投产。

## 服务器选择能力（2026-09-15）

新增多服务器登录配置，支持官方站点及自部署 origin。OAuth state、浏览器会话、runtime 获取、刷新/撤销均绑定最初选择的服务器；相同 tenant/user ID 在不同服务器下保持独立 owner。桌面企业连接页面加入站点建议并保留自由输入。配置边界与尚未交付的服务器管理界面见[服务器地址配置](32-server-connections.md)。
