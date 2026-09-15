# 服务器版 MCP 与 Skills 接入复核

日期：2026-09-14。范围：本地源码与隔离测试；未验证部署环境、真实 OAuth 登录或生产业务操作。

## 结论与修正

ORYH main 已支持通过 MCP 交付不含凭据的 Skills。此前把 `/my/skill-bundle` 当成服务器版必经入口，进而要求 ORYH 先新增 OAuth 无凭据 ZIP 接口，判断过窄；撤回这一阻塞项。服务器默认采用 OAuth + MCP，保留既有 Harness 原生会话和外部插件架构。

本轮核对 calwbiz `main` 与 `origin/main` 均为 `2e1c4b51cf97b1d2c5baef926839eefee29c8809`。关键历史为 `7e4b690`（OAuth/MCP）与 `ab54842`（按交付渠道拆分技能文本）。ZIP 仍可携带 key，但属于另一种交付方式，不进入服务器默认链路。

## 已存在的服务端能力

| 需要 | 当前实现 |
| --- | --- |
| 业务调用 | `/mcp` 的 tools，包括 `oryh_request`；通过同一 REST 服务层执行，复用权限与 actor |
| 技能发现与正文 | `prompts/list`、`prompts/get`；按调用者角色、权限与适用范围过滤 |
| 技能参考资料 | `resources/list`、`resources/read`；仅参考 Markdown，不交付 scripts 或 agents 配置 |
| 凭据隔离 | MCP 连接携带认证，正文经 `for_delivery(..., "mcp")` 渲染；不是把真实凭据交给模型再要求保密 |
| 渠道差异 | `only: bundle` / `only: mcp` 标记分离认证、脚本、同步等渠道专属说明，业务规则共用 |

源码：相邻 ORYH 仓库 `app/api/mcp.py`、`app/services/delivery.py`、`skills/_common/api-auth-principal.md`、`skills/oryh-timesheet-submit/SKILL.md`。MCP 工具发现不等于权限许可，最终请求仍须由服务端鉴权。

## 客户端实际差距

当前本地 Harness 的公开 `@deepseek-ai/dsh-mcp-client` 支持 Streamable HTTP 和工具注册，但 README 明确不支持 prompts/resources。其 transport 只传入配置的 headers，没有接入 OAuth provider、浏览器授权回调或刷新生命周期。不能把配置 Authorization header 后工具可用称为服务器 OAuth 接入完成。

1. 业务工具优先复用公开 MCP 插件。由可信 Host/连接服务按 owner 管理凭据，续期和撤销不能依赖模型操作或共享全局配置。
2. 在 ORYH 外部插件中补充窄范围的技能目录、正文和参考资料读取适配，使用公开协议/SDK 及 Harness 公共工具、技能或上下文扩展点。具体消费扩展点须验证后确定，不导入 MCP 插件的私有连接对象，不另建 Chat、Composer 或业务执行框架。
3. 目录与内容按需加载；提示中 `oryh_request` 要映射到 Harness 实际注册的工具名（如 `mcp__oryh__oryh_request`），避免模型找不到工具。参考资料的相对路径须通过已授权资源目录解析。
4. 页面和 Chat 沿用同一业务契约。MCP 调用后的资源标识/结果接入现有页面同步机制，不能认为换成 MCP 就自动完成页面切换与刷新。
5. 通用 `oryh_request` 可能执行写入，原生工具接通前必须验证可信确认、请求绑定和回执策略覆盖它，防止绕开页面正式操作流程。凭据签发等管理操作不得把秘密结果带入模型或 Session；按开放操作范围控制，不复制 ORYH 领域权限逻辑。

普通工时、项目等业务不再需要为了访问 API 而执行带凭据的脚本。隔离 Shell 原型保留给确需脚本的场景，不是所有 MCP 业务的启动前提。

## 剩余契约与验收

- OAuth：核实部署的客户端注册、服务器回调、PKCE、稳定用户/tenant 身份、刷新与撤销；同一授权贯穿技能读取和业务请求。
- 隔离：不同 owner 的 MCP 连接、缓存、Session、模型配置与后台任务不能共用凭据；旧 generation 不得续发请求。
- 内容更新：ORYH 当前声明 listChanged 为 false。客户端需主动刷新目录和按需读取；权限拒绝后不能继续使用缓存授权。多次读取没有原子 revision，记录实际内容 hash 与时间，不宣称整包快照一致。
- 确认与恢复：实际写入的确认、幂等和响应丢失后核对仍逐操作验证；MCP 的 JSON-RPC 请求 ID 不是业务幂等键。
- 部署：源码存在不代表目标测试环境已运行该版本。通过真实 OAuth 的双用户、双 tenant 联调后，才能关闭 S0-3/S0-4。

目前没有证据要求 ORYH 为基本接入新增接口。严格技能版本、特定操作幂等或跨用户资源事件若在联调中不足，再提出具体服务端缺口。

## 验证记录

在 calwbiz 运行 `tests/test_skill_delivery.py` 和 `tests/test_mcp.py`：**13 passed**，2 条依赖弃用警告。测试使用本地内存 SQLite；未访问真实业务环境或使用用户凭据。

这些测试覆盖产品技能的渠道文本检查、MCP prompts/resources、REST 权限复用等，不代替真实 OAuth 的完整浏览器链路、生产数据库隔离、Harness Profile 组合或客户端秘密泄漏测试。

相关文档：[总体方案](19-multi-tenant-server-plan.md)、[S0 验收](21-s0-acceptance.md)、[P0 实施记录](27-server-p0-implementation.md)、[可信 Host ADR](adr/0011-server-trusted-host-and-isolated-shell.md)。

## 后续实现进度

P0 已验证公开 Skill Provider 作为 prompts 消费扩展点，并实现只读资源工具；见 [第三批实施记录](27-server-p0-implementation.md#第三批mcp-远程技能-provider)。真实 SDK/HTTP 与原生注册、卸载、隔离共新增 10 项测试通过。上述客户端差距中的技能读取已有原型，OAuth、正式 Profile 和业务写入集成仍未完成。

第四批已加入 OAuth 登录事务/刷新协调器，并串联真实 MCP SDK fixture；见实施记录。当前仍未接正式 HTTP 登录入口或真实部署。另确认 ORYH 未公布 OAuth revocation_endpoint，本客户端断开与远端授权撤销必须分别报告。

第五批已用公开 WebServer 实现并测试登录路由、浏览器会话及 runtime 租约绑定。授权端/runtime 仍为 fixture；真实浏览器与完整 Profile 集成待验证，详见实施记录。

第六批已将登录路由接到 owner 运行环境池，使用真实公开 Harness HTTP/Connection/Gateway/原生前端验证共享租约与跨 owner 分离。测试 Host 为同进程内独立 Context，尚不构成多进程隔离或完整多用户 Profile 的证明。


## 2026-09-14 部署前复核

ORYH main 已推进到 `d8a3f9fb73643f28125e48323553cf9f98b158ff`，新增 `POST /oauth/revoke` 和发现文档中的 `revocation_endpoint`。上文“未公布撤销端点”是旧基线结论，当前源码已不适用。客户端 ServerOAuth 已接入远端刷新凭据撤销、同步终止本地授权并删除本地凭据；远端失败会向调用方报告失败，不伪报成功。撤销失败尚无持久重试队列。

这仍不是目标环境已部署新端点的证明。测试域名 HTTPS 当前返回 Kubernetes Ingress 默认自签名证书，公开元数据探测失败，尚未发送任何登录凭据或进行真实 OAuth 验收。
