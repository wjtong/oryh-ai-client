# ORYH Skills 装载

本文档描述 Chat 栏如何拿到 ORYH 的 Skills，以及为什么这样做。决策理由见 [ADR-0009](adr/0009-chat-pane-is-a-generic-oryh-agent.md)（Chat 栏是通用 ORYH agent）与 [ADR-0012](adr/0012-connect-to-oryh-over-mcp.md)（通过 MCP 接入）。

> **2026-09-14 起技能改从 ORYH 的 MCP 获取。** 此前下载的个人技能包把 `api_key` 写在 SKILL.md 正文和脚本里，技能一装载，key 就进入模型请求和 Session。MCP 下发的是同一批技能的 MCP 版本：没有 key、没有脚本，API 调用走 Host 注册的 ORYH 工具。下文描述的是现在的做法。

## 1. 为什么客户端要获取 Skills

ORYH 把业务逻辑放在 agent 端，Skills 就是业务逻辑的载体。租户管理员改一次规则，所有人的技能就变一次。客户端里没有、也不应该有这些规则的副本——它只负责把服务端当前授权的那份技能取下来放好。

因此这里不存在“我们支持哪些业务动作”的清单。能做什么由服务端当前发给这个人的技能决定。

## 2. ORYH 的接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/my/skills/manifest` | 当前授权的技能清单（name/version/hash），用于判断是否需要更新 |
| `POST /mcp` `prompts/list`、`prompts/get` | 每个技能的 SKILL.md（按 MCP 交付渲染：无 key、无脚本步骤） |
| `POST /mcp` `resources/list`、`resources/read` | 技能的参考文件（`oryh://skills/<skill>/<path>`，只含 `.md`） |
| `POST /mcp` `tools/list`、`tools/call` | agent 调用 ORYH 的工具：`oryh_request`、`oryh_list`、`oryh_get`、`oryh_detail`、`upload_attachment` 等 |

都用连接自己的凭据认证（`X-API-Key`，含自动续期）。`/mcp` 是无状态的 Streamable HTTP：每次交换一个 POST，JSON-RPC 进出，可以批量。不变量不变：**持有某个技能即意味着有权执行它**——服务端只下发持有人角色覆盖的技能，每个 API 仍有 `require_permission` 把关。客户端不判断某个技能能做什么。

## 3. 实现

[`packages/core/src/mcp.ts`](../packages/core/src/mcp.ts) 的 `OryhMcpClient` 说 MCP：分页列出、批量读取（每批 20 条）、JSON-RPC 错误一律抛出，不返回半套结果。

[`packages/core/src/skill-bundle.ts`](../packages/core/src/skill-bundle.ts) 的 `SkillBundleService`：

```
sync(connectionId, force?)
  ├─ manifest()                         GET /my/skills/manifest
  ├─ 与 .oryh-manifest.json 比较        清单、持有人、delivery 都相同且未强制 → 不更新
  ├─ prompts/list → prompts/get         每个技能的 SKILL.md
  ├─ resources/list → resources/read    每个技能的参考文件
  ├─ resolveEntry() 校验每个名字与路径  路径穿越、绝对路径、反斜杠一律拒绝；全部读完、校验完才写
  ├─ 整目录替换本客户端拥有的目录        服务端不再下发的技能、技能包留下的脚本都必须消失
  └─ 写 .oryh-manifest.json             { delivery: "mcp", manifest, installed, principal }
```

[`packages/dsh-host/src/mcp-tools.ts`](../packages/dsh-host/src/mcp-tools.ts) 的 `OryhMcpTools`：插件启动时、会话绑定企业时，从 `tools/list` 列出工具并注册为 agent 的原生工具（不写死名字；与 Host 自有工具重名或名字不合规的跳过），同时扩展 agent 的工具允许列表。每次调用经调用会话的企业连接发出；服务端报错以失败交给模型；非只读工具的成功调用标记该回合可能写入，回合结束时中间栏刷新。

落地位置是 `<agentsHome>/skills`（`DSH_AGENTS_HOME`，默认 `~/.agents/skills`），由 [`local-runtime.ts`](../packages/core/src/local-runtime.ts) 传入。技能按服务端名字直接装成 `<skill>/`；Harness 以 SKILL.md frontmatter 里的 `name` 识别技能，目录名不影响。

触发时机有两个：

- **工作台挂载时**，[`workbench.tsx`](../packages/web/src/client/workbench.tsx) 调用 `remote.skillSync(connection.id)`。因为先比清单，装好之后这是一次廉价的空操作。失败是静默的：没有技能工作台照常工作。
- **用户在 Chat 里要求更新时**，agent 调用 `oryh_skill_sync` 工具（`force`：显式的“更新技能”必须重新获取）。会话没有绑定页面时使用本机唯一的企业连接。

`*-skill-sync` **不安装**：这里客户端就是安装器。ORYH 通过 MCP 本来就不下发它，`withheld()` 仍按名字后缀挡住，以防某个部署仍然下发。

安全约束：

- **凭据不经过这里，也不落盘。** `SkillBundleService` 与 `OryhMcpTools` 只拿 `OryhHttpClient`，凭据始终在它内部；技能正文、参考文件都不含 key。
- **服务端返回的名字与路径不是可信输入。** 每个都要过 `resolveEntry()`；任一不安全就拒绝整次安装，不写一半——装到一半意味着 agent 同时持有两个版本。
- **只碰自己写过的目录。** skills 根与用户其它 agent 共享，`.oryh-manifest.json` 的 `installed` 记录本客户端拥有哪些目录。

## 4. 从技能包迁移

此前由技能包安装的机器，`.oryh-manifest.json` 里没有 `delivery: "mcp"`。下一次同步即使清单没变也会整目录替换：技能包的 `calwbiz-<公司>-*` 目录（含 key 的 SKILL.md 与脚本）被删除，换成 MCP 版本的技能目录。不需要用户操作，打开工作台即可。

## 5. Profile：不要在 host plane 重开这三行

`dsh-web-app` 的 profile **有意**停用了 host plane 的 `skill-filesystem`、`tool-skill`、`tool-bash`，因为 **agent preset 自带**这三个。

如果在我们的 patch 里把它们重新打开，会多出一个 host plane 的 `skill` 工具。preset 注册的那个在 scope 链上更近，会遮蔽它。而 `tool-skill` 发布 session skill catalog 的前置条件是：

```ts
const toolVisible = ctx.tools.get(skillTool.name, agent) === skillTool
```

——“当前 scope 看到的 `skill` 必须就是我注册的这个定义”。被遮蔽的那一个（host plane 的）因此永远不发布 catalog。净效果是：模型手里有 `skill` 工具，却不知道存在哪些 skill，只能靠猜名字。

真正决定 agent 能用哪些工具的是 [`business-chat.ts`](../packages/dsh-host/src/business-chat.ts) 里的 `tools.restrict({ allow })`：静态的 `toolNames` 加上从 ORYH MCP 注册的工具名。

## 6. 验证

```bash
pnpm run build && pnpm run start:alt
```

打开页面后：

1. `~/.agents/skills/.oryh-manifest.json` 里 `delivery` 为 `mcp`，`installed` 列出技能目录；技能目录里没有 `.py` 文件，也搜不到 key；
2. 新建会话，让 agent 用 `oryh_request` 读一张单据，期望调用 Host 注册的 `oryh_request` 工具而不是 `bash`；
3. 想直接确认 catalog 是否发布，解压会话日志找 `skill-catalog`：

```bash
zstd -d -c ~/Library/Application\ Support/ORYH\ AI\ Client/harness/sessions/*/session-*/session.v3.jsonl.zstd | grep -c skill-catalog
```

2026-09-14 实测：经 MCP 安装 34 个技能，原 35 个技能包目录清除，含 key 的文件 0 个、脚本 0 个；agent 用 `oryh_request` 读回工时单 `status: draft`、`submitted_at: null`。

## 7. 已知取舍

- **依赖部署提供 `/mcp`。** 未提供时技能同步失败，不回退到带 key 的技能包。
- **技能仍以持有人身份说话。** MCP 版本的正文里有持有人的员工编号与姓名；`<agentsHome>` 在共享主机上仍应按身份隔离（不再因为凭据，而是因为这些身份信息与会话数据），见 [docs/21](21-s0-acceptance.md) S0-2。
- **只读调用也可能触发一次页面重读。** 服务端没给工具标 `readOnlyHint` 时，Host 无法区分读写，保守地在回合结束时让页面重读。
- **catalog 是该机器上全部 skill**（含用户自己装的其它 agent 技能），不只是 ORYH 的那些。如果噪音成为问题，再考虑按 `.oryh-manifest.json` 收窄。
