# ADR-0012：通过 ORYH 的 MCP 接入：技能不带凭据，API 调用走 Host 的工具

状态：接受
日期：2026-09-14

## 背景

[ADR-0009](0009-chat-pane-is-a-generic-oryh-agent.md) 让 Chat 栏按 ORYH 对通用 agent 的方案下载个人技能包（`GET /my/skill-bundle`），原样落盘，agent 用 `bash` 跑包里的脚本调用 API。2026-09-14 查实：ORYH 把个人 `api_key` 写在 SKILL.md 正文里（本机 35 个技能中 34 个），脚本里也有；Harness 的 `skill` 工具装载时把正文原样交给模型，于是 key 随每次装载进入模型请求，并随工具结果写进 Session（ADR-0009、ADR-0002、D-012 的同日更正）。

ORYH 服务端同时提供另一条交付路径：`POST /mcp`（无状态 Streamable HTTP，JSON-RPC）。

- **工具**是 REST 契约的绑定：`oryh_request`（按技能文档调用任意 REST 操作）、`oryh_list`、`oryh_get`、`oryh_detail`、`upload_attachment` 等，按调用者的凭据执行，权限、RLS 与审计戳和 REST 调用一致。
- **技能**以 MCP prompts 下发（SKILL.md），参考文件以 resources 下发（只含 `.md`，不含 `scripts/` 与 `agents/`），按角色过滤；ORYH 自己的 `*-skill-sync` 不下发。
- 技能模板用 `<!-- only: bundle -->` / `<!-- only: mcp -->` 区分两种交付：MCP 版本里没有 key、没有脚本，写的是“每次调用都是一次 `oryh_request` 工具调用”。`ORYH_API_KEY` 占位符被渲染成说明文字，而不是 key。
- 认证接受 `X-API-Key` 或 OAuth Bearer；本客户端现有的连接凭据（`X-API-Key`，含自动续期）可以直接使用。

用户的要求（2026-09-14）：让 oryh-ai-client 用 MCP 连接 ORYH，再获取全部技能，使技能不再带凭据。

## 决定

1. **技能从 MCP 获取。** `SkillBundleService.sync` 仍先比 `GET /my/skills/manifest` 决定是否需要更新；需要时经 MCP 读取全部 prompts 与 resources，按 `<skill>/SKILL.md`、`<skill>/<path>` 装进 `<agentsHome>/skills`。`.oryh-manifest.json` 记 `delivery: "mcp"`：此前由技能包安装的目录（文件里有 key）即使清单未变也会被整目录替换。不再下载 ZIP，也不再安装脚本。
2. **API 调用走 Host 注册的 ORYH 工具。** Host 自己作为 MCP 客户端，从服务端 `tools/list` 列出工具并注册为 agent 的原生工具（不在代码里写死工具名；与 Host 自有工具重名、名字不合规的跳过）。每次调用经调用会话的企业连接发出，凭据只在 `OryhHttpClient` 内部，并随连接续期。工具名单随注册动态加入 agent 的允许列表。
3. **不用 Harness 的 `dsh-mcp-client` 插件。** 它的凭据是 Profile 里的静态请求头，跟不上连接凭据的续期，也无法按会话选择企业连接；而且它只桥接 tools，不支持 prompts 与 resources，拿不到技能。
4. **对话写入的刷新信号。** 一次调用不是服务端标为只读（MCP `readOnlyHint`）的工具、且服务端没有报错，就标记该回合可能写入；回合结束时照旧移动 `serverChange`（ADR-0010）。服务端报错的调用以失败交给模型，不标记。
5. **agent 规则。** skill 里的每次 ORYH API 调用都用这些工具完成，不为调用 ORYH 写脚本、用 curl，也不寻找或读取任何 API key；`bash` 只做本地处理（例如生成报表文件）。

## 边界

- **授权仍在服务端。** MCP 工具按调用者凭据执行，与 REST 相同；服务端只下发该角色覆盖的技能。
- **凭据不进模型请求与 Session。** 技能正文与参考文件都不含 key；工具调用的凭据在 Host 进程内。这条在本 ADR 之后对 ORYH 的 key 重新成立。
- **写入确认不变。** 仍按 skill 在对话里确认后执行（ADR-0010）。
- **技能仍以持有人身份说话。** MCP 渲染的技能正文里有持有人的员工编号与姓名，持有人记录与 `oryh-skill-identity` 保留（ADR-0010 §5）；同一时刻仍以一个企业身份安装技能。

## 取代与修订

| 原结论 | 现状 |
| --- | --- |
| [ADR-0009](0009-chat-pane-is-a-generic-oryh-agent.md) 决定 1：下载与通用 agent 相同的个人技能包、原样落盘、保留渲染进去的 `ORYH_API_KEY` | 本 ADR 取代。技能经 MCP 获取，不含凭据 |
| ADR-0009 决定 2：`bash` 用来执行技能的脚本步骤 | 本 ADR 修订。技能不再有脚本步骤；API 调用走 Host 注册的 ORYH 工具，`bash` 保留给本地处理 |
| ADR-0009 决定 4：安装时把 `<company>/<skill>` 提升到扫描根 | 不再需要。MCP 按技能逐个下发，直接装成 `<skill>/` |
| ADR-0009、ADR-0010、ADR-0002、D-012 的 2026-09-14 更正：key 随 skill 装载进入模型请求与 Session | 本 ADR 消除了这一缺口；桌面版“暂不遮盖 key”的决定随之不再需要 |
| [多租户方案](../19-multi-tenant-server-plan.md) §6.2、[S0 验收](../21-s0-acceptance.md) S0-4：不含凭据的技能包是服务器版 P0 前提，待 ORYH 提供 | ORYH 已经通过 MCP 提供，本客户端已接入。两份文档此刻正由服务器版 P0 工作修改，同步留给那份工作合并时处理 |

## 后果

正面：

- 模型请求、Session 与技能目录里都不再有 ORYH 的 key，技能目录不必再按凭据对待；
- 技能里不再有要跑的脚本，agent 调用 ORYH 不需要 shell，服务器版的“租户脚本执行”面随之缩小；
- 工具名单与技能都随服务端变化，客户端不写死。

负面与待办：

- 依赖部署提供 `/mcp`；未提供时技能同步失败（工作台照常，Chat 少了技能），不回退到带 key 的技能包；
- MCP 工具没有标 `readOnlyHint` 时，只读调用也会让页面在回合结束时重读一次（GET，不打断用户）；
- 已由技能包安装的机器，下一次挂载工作台时会被替换一次（`delivery` 不是 `mcp`）。

## 验收（2026-09-14 实测）

- 打开工作台后技能改为经 MCP 安装：34 个技能，`delivery: "mcp"`，持有人已记录；原先 35 个技能包目录已清除；技能目录中含 key 的文件 0 个、Python 脚本 0 个。
- 在 Chat 里要求“用 `oryh_request` 发一次 `GET /timesheet-headers/<id>`”：agent 调用经 MCP 注册的 `oryh_request`，返回 `status: draft`、`submitted_at: null`，与页面一致，未使用 `bash`。
