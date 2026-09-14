# ADR-0009：Chat 栏是一个通用 ORYH agent，按 ORYH 自己的方案装载 Skills

状态：接受；「边界」中「三栏的业务写入仍需用户在页面确认」一条已被 [ADR-0010](0010-agent-is-the-primary-client.md) 取代（2026-09-14）
日期：2026-09-12

## 背景

ORYH 的哲学是：**服务端只管记录，业务逻辑放在 agent 端**。之所以这样切分，是因为企业里大量规则很难用代码表达，或者实现后改动代价太大——"一周不少于 30 小时"这类约束不是非黑即白的判断，写成代码就固化了。ORYH 把这些逻辑交给 Skills：租户管理员一句话重新定义业务逻辑，所有人的 skill bundle 随之更新。

ORYH 对通用 agent 已有现成接入方案（见 calwbiz `docs/manual/connect-agent.md`、`docs/capabilities-skills-api.md`）：

- `GET /my/skill-bundle`（`X-API-Key`）返回该人当前有权持有的 skill ZIP，里面已把 `ORYH_API_KEY` 渲染进文件；
- `GET /my/skills/manifest` 返回同一份授权的清单，用于判断是否需要重新下载；
- 不变量是"持有某个 skill 即意味着有权执行它"——bundle 只会包含该人角色已覆盖的 skill，API 侧仍有 `require_permission` 把关。

本客户端此前没有实现任何 skill 装载：Chat 栏只有 17 个窄业务工具（ADR-0007 §3、D-008 关掉了 Bash 与通用能力；ADR-0002 §5 要求 bundle 只在 Host 内存里解析并剥掉 `ORYH_API_KEY`）。实测结果是 Chat 栏答不了"加一条规则：提交的工时一周不能少于 30 小时"——它没有任何途径知道这条规则该写到哪里，也没有执行手段。

用户的判断是：**oryh-ai-client 就是一个普通 agent，跟其它通用 agent 没有本质区别**。其它 agent 能把 token 写进 skill 明文，它也可以；其它 agent 在 chat 里能做的事，这个 chat 栏也要能做。

窄工具方案在两点上被证伪：

1. **跟不上变更。** skill 随时更新，租户管理员改一句话就是一次新版本。窄 `oryh_api` 工具的参数面是编译期固定的，每次业务语义变化都要改客户端、发版本；而 skill 的更新是服务端的事。
2. **跑不动 skill。** 实测 bundle 里有 52 个 Python 文件，其中三个是真正的执行器（`oryh_request.py` 107 行、`bulk_import.py` 216 行、`upload_attachment.py` 143 行）。skill 的步骤是"运行这个脚本"，不是"发一个 HTTP 请求"。没有 shell，catalog 就是死的。

## 决定

1. **Chat 栏按通用 ORYH agent 对待。** 客户端下载与其它通用 agent 完全相同的 personal bundle，落到相同位置（`<agentsHome>/skills`，默认 `~/.agents/skills`），保持 ORYH 渲染进去的原始文件，**不**做"内存解析＋剥离 `ORYH_API_KEY`"的兼容适配。
2. **`skill` 与 `bash` 进入 agent 的工具允许列表**（`business-chat.ts` 的 `tools.restrict({allow})`）。`skill` 让模型看见 catalog 并按名装载；`bash` 让 skill 的脚本步骤真的能跑。
3. **不在 host plane 重新打开 `skill-filesystem` / `tool-skill` / `tool-bash`。** 这三行被 `dsh-web-app` 的 profile 有意停用，因为**agent preset 自带**它们。在 host plane 再注册一个 `skill` 工具会遮蔽 preset 注册的那一个，而 `tool-skill` 发布 catalog 的前置条件正是"当前 scope 看到的 `skill` 就是我注册的那个定义"——于是 catalog 永远不会发布，模型拿着 `skill` 工具却不知道有哪些 skill。真正挡住这两个工具的是我们自己的允许列表。
4. **安装时把 skill 提升到扫描根。** ORYH 发的是 `<company>/<skill>/SKILL.md`；Harness 的 `skill-filesystem` 只扫一层，找 `<root>/<skill>/SKILL.md`。整包放进去，公司容器里没有 `SKILL.md`，会被静默跳过，什么都发现不了。安装时把每个 skill 目录提到根，公司容器下的散文件（`README.md` 等）不安装。这是安全的：ORYH 已经用雇主名给每个 skill 命名，这正是一个 agent 能同时服务两家公司的前提。
5. **同步以服务端清单为准。** 先比 `/my/skills/manifest`，不同才下载；本地 `.oryh-manifest.json` 记录"这次装的是哪份授权、写了哪些目录"。只整目录替换自己写过的目录——角色变更收回的 skill 必须真的消失，而 skills 根是与用户其它 agent 共享的，不属于本 bundle 的目录一律不碰。
6. **客户端独占安装，ORYH 的 `*-skill-sync` 技能不安装。** 那个技能是给通用 agent 的安装器；在这里客户端就是安装器，装着它等于有两个安装器，而它按 ORYH 的原始目录结构解压，本客户端扫描不到。用户在 Chat 里要求更新技能时走 `oryh_skill_sync` 工具。这是对"原样安装 ORYH 发来的 bundle"的唯一一处有意偏离。
7. **多租户/共享主机下 `<agentsHome>` 必须按 uid 隔离。** bundle 里有该人的 `ORYH_API_KEY`，同一个 skills 根就是同一个人。[docs/21](../21-s0-acceptance.md) S0-2 的 per-uid 由"可选"变为"必须"。

## 边界（本决定没有放松的部分）

- **授权仍在服务端。** 每个 ORYH API 都有自己的 `require_permission`；bundle 只包含持有人角色已覆盖的 skill。客户端不判断某个 skill 能做什么。
- **凭据仍不进模型上下文、Session、日志与遥测。** 变的是"skill 文件里有 ORYH 渲染的 key"，不是"我们把 key 喂给模型"。`OryhHttpClient` 持有的凭据仍然只在 Host 进程内。
- ~~**三栏的业务写入仍需用户在页面确认。**~~（已被 [ADR-0010](0010-agent-is-the-primary-client.md) 取代：agent 是主客户端，写入按 skill 在对话里确认后执行，中间栏是辅助视图。） `oryh_*` 工具依旧只读或只生成建议，正式保存/提交/审批由用户在中间栏完成（[docs/22](../22-timesheet-submit-review.md) 的提交前规范复核也不改变这一点）。

## 取代与修订

| 原结论 | 现状 |
| --- | --- |
| [ADR-0002](0002-credentials-outside-model-context.md) §5：bundle 只在 Host 内存解析，剥离 `ORYH_API_KEY`，原始 ZIP 与 Markdown 不得落盘 | 本 ADR 取代。bundle 按 ORYH 原样落盘到用户自己的 skills 根，与其它通用 agent 一致 |
| [ADR-0002](0002-credentials-outside-model-context.md) 后果："通用 Bash/curl Skill 不能直接复用，必须有窄业务工具" | 本 ADR 取代。窄工具跟不上 skill 的更新节奏，也跑不动 skill 的脚本步骤 |
| [ADR-0007](0007-dsh-web-profile-and-typed-remotes.md) §3：preset 不启用 Bash、任意文件、终端 | 部分失效。`bash` 与 `skill` 已进入允许列表；其余（终端、自修改、通用网络）不变 |
| [D-008](../08-decisions-and-open-questions.md)：生产 Profile 禁用 Bash | 部分失效，同上 |
| [D-012](../08-decisions-and-open-questions.md)：模型与持久缓存只接收无凭据 Skill 内容 | 本 ADR 取代其"持久缓存"部分。skill 文件按原样落盘；"凭据不进模型请求"仍然成立 |

ADR-0002 中与本 ADR 无关的条款（access/refresh token 不进模型请求、多企业凭据由 Session scope 决定、不用正则清洗任意文本）继续有效。

## 后果

正面：

- Chat 栏获得与其它通用 agent 相同的能力面：租户管理员改一句话，这里立刻跟上，客户端不发版本；
- 业务逻辑留在 Skills，符合 ORYH 的哲学——不把"一周 30 小时"这类规则翻译成客户端代码；
- 与 ORYH 既有方案基本一致（唯一偏离是 §6 的 `*-skill-sync`），不再维护一条只有本客户端走的兼容路径。

负面与待办：

- `ORYH_API_KEY` 以明文存在于用户自己的 `~/.agents/skills` 下。这是 ORYH 对所有通用 agent 的既有姿态，用户明确接受；ADR-0002 §9 提到的"服务端提供无凭据 canonical skill 内容"仍是值得推动的 P1；
- 打开 `bash` 后模型可执行任意命令，边界回到 Harness 自身的工具批准与访问模式；
- 共享主机上的 per-uid skills 根成为硬性前提（见上）。

## 验收

在全新会话里对 Chat 栏说"加一条规则：提交的工时一周不能少于 30 小时"。期望：模型从 catalog 里认出相关 skill、`skill` 装载、追问生效日期，然后通过 `bash` 运行 skill 的脚本向服务端发布流程定义。2026-09-12 实测通过（发布 `HR-TM-001 v1`，catalog 69 条）。
