# ORYH Skills 装载

本文档描述 Chat 栏如何拿到 ORYH 的 Skills，以及为什么这样做。决策理由见 [ADR-0009](adr/0009-chat-pane-is-a-generic-oryh-agent.md)。

## 1. 为什么客户端要下载 Skills

ORYH 把业务逻辑放在 agent 端，Skills 就是业务逻辑的载体。租户管理员改一次规则，所有人的 bundle 就变一次。客户端里没有、也不应该有这些规则的副本——它只负责把服务端当前授权的那份 bundle 取下来放好。

因此这里不存在"我们支持哪些业务动作"的清单。能做什么由服务端当前发给这个人的 skill 决定。

## 2. ORYH 的接口

| 接口 | 用途 |
| --- | --- |
| `GET /my/skills/manifest` | 当前授权的 skill 清单（name/version/hash），用于判断是否需要重新下载 |
| `GET /my/skill-bundle` | 该人当前有权持有的 skill ZIP，`ORYH_API_KEY` 已渲染进文件 |

两者都用 `X-API-Key` 认证。不变量：**持有某个 skill 即意味着有权执行它**——bundle 只包含持有人角色已覆盖的 skill，API 侧仍有 `require_permission` 把关。客户端不判断某个 skill 能做什么。

## 3. 实现

[`packages/core/src/skill-bundle.ts`](../packages/core/src/skill-bundle.ts) 的 `SkillBundleService`：

```
sync(connectionId, force?)
  ├─ manifest()                     GET /my/skills/manifest
  ├─ 与 .oryh-manifest.json 比较    相同且未强制 → 不下载
  ├─ download()                     GET /my/skill-bundle → ZIP
  ├─ resolveEntry() 校验每个条目     路径穿越、绝对路径、反斜杠一律拒绝
  ├─ installPath() 规划安装位置      见 §4
  ├─ 整目录替换本 bundle 拥有的目录   角色变更收回的 skill 必须真的消失
  └─ 写 .oryh-manifest.json          { manifest, installed }
```

落地位置是 `<agentsHome>/skills`（`DSH_AGENTS_HOME`，默认 `~/.agents/skills`）——与其它通用 agent 同一个位置，由 [`local-runtime.ts`](../packages/core/src/local-runtime.ts) 传入。

触发时机：[`workbench.tsx`](../packages/web/src/client/workbench.tsx) 在工作台挂载时调用 `remote.skillSync(connection.id)`。因为先比清单，装好之后这是一次廉价的空操作。失败是静默的：没有 skill 工作台照常工作，在这里弹错比让 Chat 少知道一点更糟。

安全约束：

- **凭据不经过这里。** `SkillBundleService` 只拿 `OryhHttpClient`，凭据始终在它内部。
- **ZIP 是服务端数据，不是可信输入。** 每个条目名都要过 `resolveEntry()`；任一条目不安全就拒绝整包，不写半个 bundle——装到一半意味着 agent 同时持有两个版本。
- **只碰自己写过的目录。** skills 根与用户其它 agent 共享，`.oryh-manifest.json` 的 `installed` 记录本 bundle 拥有哪些目录。

## 4. 目录布局：为什么要"提升一层"

ORYH 发的是：

```
calwbiz-jc-medical/
  README.md
  calwbiz-jc-medical-timesheet-submit/SKILL.md
  calwbiz-jc-medical-timesheet-submit/scripts/oryh_request.py
calwbiz-connect/SKILL.md          ← 共享的 connect skill 本来就在顶层
```

Harness 的 `skill-filesystem` **只扫一层**，找 `<root>/<skill>/SKILL.md`。整包放进去，`calwbiz-jc-medical/` 会被读成"一个没有 SKILL.md 的 skill"，一个都发现不了（症状是 `skill "…" is unknown or no longer available`）。

`installPath()` 因此把每个 skill 目录提到根：

- 顶层目录自己带 `SKILL.md` → 原样安装（共享的 connect skill）；
- 否则是公司容器，第二段才是 skill 目录，提到根；
- 容器下的散文件（`README.md`、`withheld.json`）描述的是 bundle 而不是 skill，不安装——留着会多出一个被扫描器读成坏 skill 的目录。

这样做是安全的：ORYH 已经用雇主名给每个 skill 命名（`calwbiz-jc-medical-*`），这正是一个 agent 能同时服务两家公司的前提。

## 5. Profile：不要在 host plane 重开这三行

`dsh-web-app` 的 profile **有意**停用了 host plane 的 `skill-filesystem`、`tool-skill`、`tool-bash`，因为 **agent preset 自带**这三个。

如果在我们的 patch 里把它们重新打开，会多出一个 host plane 的 `skill` 工具。preset 注册的那个在 scope 链上更近，会遮蔽它。而 `tool-skill` 发布 session skill catalog 的前置条件是：

```ts
const toolVisible = ctx.tools.get(skillTool.name, agent) === skillTool
```

——"当前 scope 看到的 `skill` 必须就是我注册的这个定义"。被遮蔽的那一个（host plane 的）因此永远不发布 catalog，而 preset 的那一个……模型看到的是被遮蔽后的结果。净效果是：模型手里有 `skill` 工具，却不知道存在哪些 skill，只能靠猜名字。

真正挡住 `skill`/`bash` 的从来不是 profile，而是 [`business-chat.ts`](../packages/dsh-host/src/business-chat.ts) 里我们自己的 `tools.restrict({ allow: toolNames })`。把 `'skill'`、`'bash'` 加进 `toolNames` 就够了。

## 6. 验证

```bash
pnpm run build && pnpm run start:alt
```

打开页面后：

1. `ls ~/.agents/skills | grep calwbiz` 应看到被提升到根的 skill 目录，以及 `.oryh-manifest.json`；
2. 新建会话，问"加一条规则：提交的工时一周不能少于 30 小时"。期望模型 `skill` 装载相关 skill、追问生效日期，再用 `bash` 跑脚本向服务端发布流程定义；
3. 想直接确认 catalog 是否发布，解压会话日志找 `skill-catalog`：

```bash
zstd -d -c ~/Library/Application\ Support/ORYH\ AI\ Client/harness/sessions/*/session-*/session.v3.jsonl.zstd | grep -c skill-catalog
```

2026-09-12 实测：catalog 69 条，端到端发布 `HR-TM-001 v1`（"每周提交的工时合计不得少于 30 小时"）。

## 7. 已知取舍

- **`ORYH_API_KEY` 明文落在用户自己的 `~/.agents/skills` 下。** 这是 ORYH 对所有通用 agent 的既有姿态。ADR-0002 §9 提到的"服务端提供无凭据 canonical skill 内容"仍值得推动。
- **`<agentsHome>` 必须按 uid 隔离。** 同一个 skills 根就是同一个人的凭据。见 [docs/21](21-s0-acceptance.md) S0-2。
- **catalog 目前是该机器上全部 skill**（本次实测 69 条，含用户自己装的其它 agent 技能），不只是 ORYH 的那 36 个。如果噪音成为问题，再考虑按 `.oryh-manifest.json` 收窄。
