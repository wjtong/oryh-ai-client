# ADR-0002：凭据不得进入模型上下文

状态：接受；§5 与"必须有窄业务工具"一条已被 [ADR-0009](0009-chat-pane-is-a-generic-oryh-agent.md) 取代（2026-09-12）
日期：2026-08-19

> **2026-09-12 修订。** Chat 栏被确认为一个通用 ORYH agent，按 ORYH 对所有通用 agent 的既有方案装载 skill bundle：原样落盘到 `<agentsHome>/skills`，保留 ORYH 渲染进去的 `ORYH_API_KEY`。下述 §5 的"仅 Host 内存解析、剥离认证字段、原始 ZIP 与 Markdown 不得落盘"，以及后果中的"通用 Bash/curl Skill 不能直接复用，必须有窄业务工具"，均由 [ADR-0009](0009-chat-pane-is-a-generic-oryh-agent.md) 取代。本 ADR 的其余条款——access/refresh token 与模型 key 不进入模型请求、Session、日志与遥测；多企业凭据由 Session scope 决定；不以正则清洗任意文本——继续有效。

> **2026-09-14 更正。** 上面说“其余条款继续有效”，但照原样装载的 skill bundle 让 ORYH 的 `api_key` 进入了模型请求与 Session：它写在 SKILL.md 正文里，`skill` 工具装载时正文原样交给模型——正是本文背景所说的扩散。access/refresh token 与模型 key 不进模型请求的条款仍然成立；ORYH skill 里的 key 曾是已知缺口，同日改为经 MCP 获取不含凭据的技能后消除（[ADR-0012](0012-connect-to-oryh-over-mcp.md)），本 ADR 的不变量对 ORYH 的 key 重新成立。

## 背景

ORYH 当前 personal Skill bundle 会把用户短期 access token 渲染进 Markdown，方便通用 Agent 通过 `curl` 调 API；refresh token 不在 bundle 中。DSH 的模型可见内容会写入 Session 以支持重放；因此把真实 token 写进 Skill 会同时扩大到模型 Provider、Session、缓存、日志和遥测。

DSH 的本地 YAML credential provider 使用 owner-only 文件权限，但同一 OS 用户下的工具进程仍可读取该文件，不能作为模型隔离的安全边界。ORYH 专属客户端又不需要让模型自己拼接 HTTP，因此可以把认证完全移出模型平面。

## 决定

1. ORYH access token、refresh token、模型 key 和本地加密 key 不进入模型请求、Skill、Session、Renderer、普通日志、遥测或诊断。
2. 生产使用 OS Keychain/Credential Manager provider 保存秘密。
3. Session 和工具只持有不解析秘密的 `ConnectionId`；ORYH API service 在主进程传输层解析正确 credential reference。
4. refresh 由确定性 auth/API service 处理，不由模型根据 401 文本决定。
5. 首个纵向切片可适配现有 `/my/skill-bundle`，但仅限 Host 在内存中读取：适配器必须按已知 ORYH bundle 结构解析，移除其唯一被渲染的 `ORYH_API_KEY` 认证字段，验证结果不再含秘密后才发布给 Skill registry；原始 ZIP、原始 Markdown 和 token 不得落盘、进入 Renderer、Session、模型、日志或遥测。它不是正则“清洗”任意文本：结构、文件清单和秘密扫描任一不符合预期即拒绝该次同步并保留 last-known-good。
6. 生产 Profile 禁用能读取任意用户文件的模型工具，作为额外纵深防御。
7. 测试使用 canary secrets 扫描模型、Session、UI、日志、诊断和构建产物。
8. 每个连接的 access/refresh、到期时间和 generation 作为一个 credential bundle 原子替换；本地锁定只释放或清除内存秘密，不改变服务端授权。
9. ORYH 后端仍应提供按当前权限返回的 canonical 无凭据 Skill content（含 hash/ETag）；这是消除兼容适配器、服务端可验证发布与其他 Agent 复用的 P1 契约，不是当前客户端开始开发的前置条件。

## 后果

正面：

- token 不会因正常对话和重放而持久扩散；
- refresh 和重试在一个实现中保持正确；
- 模型无法有意或被注入地回显真实认证信息；
- 多企业凭据选择由 Session scope 决定，而不是 Skill 文件名或模型判断。

代价：

- 需要实现跨平台 Credential Provider；
- 当前 bundle 适配器需要保持与 ORYH 模板精确一致，并在模板变化时安全拒绝；
- ORYH 后端仍需提供无凭据 eligible Skill 内容，以移除这一临时兼容路径；
- ~~通用 Bash/curl Skill 不能直接复用，必须有窄业务工具~~（[ADR-0009](0009-chat-pane-is-a-generic-oryh-agent.md) 取代：窄工具跟不上 skill 的更新节奏，也跑不动 skill 的脚本步骤）；
- 本地高信任 Host 仍需严密保护和签名发布。

## 未选择的方案

### 继续把短期 access token 交给模型或持久化缓存

拒绝。短期 token 只缩短泄漏窗口，不能关闭泄漏通道，且 Session 可在过期后继续保存秘密。Host 内存中的严格 bundle 适配不属于此方案：它从不把原文发布给模型或缓存，并在完成转换后丢弃原始字节。

### 使用环境变量

拒绝。子进程、诊断和同 UID 进程容易读取；也不能可靠表示多租户和轮换。

### 使用 `0600` YAML credential 文件

仅允许无真实秘密的开发测试。它隔离其他 OS 用户，不隔离模型拥有的同 UID 文件读取能力。

### 让 Renderer 管理 token

拒绝。XSS、DevTools、前端网络状态和浏览器存储都会扩大攻击面。

## 重新评估条件

该安全不变量不计划放宽。未来可以把 OS Keychain 替换为企业设备身份、硬件保护或模型/ORYH 网关，但仍需保持秘密不进入模型和 Renderer。
