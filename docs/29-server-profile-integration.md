# 服务器 Profile 接入清单

日期：2026-09-14。状态：公开解析器审计完成；尚未生成可部署 Profile。

## 已验证的事实

通过公开 `@deepseek-ai/dsh-app-boot` 的 `initProfile`、`loadProfileDirectory`、`composeEntries`，在临时目录解析 base + web-app + ORYH bundle。没有读取用户 Profile、用户 patch 或 `.env`，没有启动该组合。共 156 个配置条目，patch 警告为 0。脱敏结果见 [配置条目](evidence/profile-source-audit-2026-09-14.json)，只有 id/name/disabled，没有配置值。

可重跑：`node packages/server-lab/probes/profile-audit.mjs docs/evidence/profile-source-audit-2026-09-14.json`。此脚本只作源码组合审计，不是服务器启动入口。

## 必须处理的组合差异

| 现有入口 | 服务器接入要求 |
| --- | --- |
| `credentials` / credentials-local | 使用可信服务器凭据服务；用户界面仅显示配置状态，不能通过记录管理读取别人的授权 |
| `subprocess` / subprocess-local、`bash-sandbox` | 审计全部执行入口；MCP 业务无需默认启用 Shell。需要脚本时接隔离执行 provider，不能保留可绕过它的本地入口 |
| `workspace-controller`、`workspace-files` | 只允许服务器分配的 owner 数据根，逐资源鉴权；不能仅隐藏目录选择控件 |
| `oryh-directory-picker-host/ui` | 服务器版关闭本机目录浏览；默认 Workspace 已由可信初始化器创建 |
| `plugin-inventory`、`ui-settings-plugins` | 区分查看与安装/配置能力；服务器固定受信插件，不开放用户改变 Host 组合 |
| `agent-presets` | 明确服务器专用 Agent 组合。host 层 tool-bash/skill-filesystem 的 disabled 不能替代 preset 作用域审计 |
| `oryh-client-host` | 注入已验证 owner 与服务器凭据连接，关闭桌面设备连接/ZIP 同步路径；页面业务与 MCP 调用使用同一授权主体 |
| `oryh-client-ui` | 保留现有业务 Slot、菜单和原生 conversation；接服务器登录态，不复制 UI/会话/Composer |
| `Connection` / `Gateway` / 原生前端 | 保留官方协议，完成控制域到 owner 域的一次性转接、过期/注销后的连接关闭与附件鉴权 |

此表列的是需要核验的入口，不把插件名称等同于漏洞，也不以静态禁用状态作为安全验收。Profile 的运行时 Agent 扩展没有包含在这次静态树中。

## 按依赖推进

1. **业务 Host 身份适配**：给现有 ORYH 服务注入可信 owner/连接来源，避免在完整 Profile 中重新出现桌面密钥和设备登录流程。首先开放只读操作。
2. **服务器 Agent preset**：将 MCP Skill Provider 和参考资料工具装入正确作用域，验证原生 skill 加载、工具命名映射及任务边界刷新。接业务 tools 前覆盖可信确认/回执政策。
3. **受信 Profile bundle**：继续由外部 bundle 声明组合，利用官方解析器和 Loader 验证真实插件生命周期；禁止把当前最小 Host 的手工组合冒充 Profile 迁移完成。
4. **完整原生会话**：通过实际 agent-loop 创建/恢复持久化会话，用无外部密钥的受控模型 fixture 验证写入，再开展明确测试身份下的真实模型联调。不得仅添加自写聊天接口绕过此链路。
5. **浏览器和部署**：完成一次性域间转接、实际 HTTPS Cookie、跨用户访问、关闭连接、下载/附件、重启恢复和容器执行限制；再讨论启用服务器 Profile。

## Session 持久化进展

第八批已通过公开 SessionPersistence 写句柄创建、append、flush、close，再在另一个 Host 进程中按 ID 读取。测试包含原生 user/message 和 assistant/message 事件，正常关闭与 SIGKILL 后内容一致，其他 owner 查询拒绝。

这些消息明确来自测试 fixture，未调用模型。它们证明原生存储事件与 owner 根隔离，不证明 Agent loop、模型生成、工具执行、对话界面或未完成回合修复已经完成。生产 agent-loop 必须在发布 Session 前取得写句柄；单独 `sessions.create` 加 `session/flush` 不会自动存储。


## 业务身份适配进展（第九批）

核心层已增加 `createServerReadHost`，复用现有 Controller 与查询服务。服务器回调负责 OAuth 凭据，初始化复核 owner，授权取消清空缓存并阻止在途结果返回。实验包已连接 OAuth 刷新/注销生命周期；只开放项目、待办、费用列表与身份复核。设备连接、带凭据 ZIP、写入和 schema 下载不可用，桌面路径保留。

第 1 步仍未整体完成：`oryh-client-host` 插件仍按桌面模式创建 runtime，Remote/BusinessChat 的技能接口仍依赖桌面 SkillBundleService。下一步应先拆分这些能力并注入可信运行时，再将服务器 MCP SkillProvider 挂入 Agent 作用域；不能用空的 ZIP 服务或假凭据满足依赖。共享 owner 进程不得永久绑定第一个浏览器授权，需逐调用归属与注销隔离后才接入完整浏览器链路。


## 技能能力拆分进展（第十批）

BusinessChat 与 Remote 已依赖统一 `OryhSkillService`，桌面适配器保留 ZIP 安装行为；服务器 MCP 适配器只刷新目录并报告可信身份。只读 OAuth runtime 可在指定 Harness 作用域挂载 MCP Provider，注销和卸载后失效。公开 Scope 的兄弟隔离已测试，但未使用实际 Agent setup 或模型回合。

下一步重点转为服务器 Agent 的真实组合与工具策略：现有桌面 BusinessChat 的 Bash 许可和业务写入提示不能直接复用；服务器必须明确暴露可执行的只读操作，不能只改提示词。同时完成 `oryh-client-host` 的可信运行时入口，维持主 Profile 未启用的保护。完整 Remote 服务依赖、写入确认和共享 owner 进程中的逐调用授权仍需接续。


## 原生服务器 Agent 进展（第十一批）

已通过公开 AgentRegistry.create 的 unpublished setup 装入服务器只读插件及 MCP Provider，使用独立提示和原生工具限制/guard。实际 AgentLoop 配合脚本化模型完成 skill → 项目查询 → 回复，事件由原生 loop 落盘并回读。继承 Bash 的拒绝、注销清理和 setup 期间授权撤销也已验证。

这完成了第 2 步的只读 Agent 工厂与第 4 步的一部分真实回合验证。工厂尚未由部署 Profile、正式业务 Host/Remote 或浏览器登录入口调用，也未实现 Agent resume。下一步应把可信工厂接入外部服务器 bundle 和原生入口，保证只能使用分配的 owner workspace 与有效授权；然后验证真实 Loader 生命周期和浏览器组合，而非再创建一套会话接口。


## 外部 bundle / Loader 进展（第十二批）

实验包现有独立 11 项服务器 bundle 和外部 profile-plugin，已用公开 Profile 解析器、实际 package export 和 boot Loader 激活，执行原生只读对话后完整卸载。可信 authority 必须由启动端注入，持久化目录必须显式配置；缺少 authority 和关闭期间未完成的 Agent 创建都已测试。

第 3 步已具备实验性真实 Loader 证据，尚不是部署 bundle。当前入口只有 Host 内部能力，未接浏览器 New Session/恢复及登录域转接；后续必须让这些原生入口进入可信工厂，并限制 Workspace 与 owner 的对应关系。此前“尚未通过部署 Profile 调用工厂”的状态现已推进为“实验 bundle 已调用，生产浏览器入口未接通”。


## 浏览器入场边界进展（第十三批）

Agent 工厂已拒绝任意 workspace 字符串，改用服务器签发且匹配 grant.owner 的工作区能力。原生 SessionController 的 create/resume/fork 尚未接该工厂；其 preset 共享作用域也不能代替逐请求授权。[原生入口接入清单](30-native-session-admission.md)记录了公开 Connection/Gateway/preset 扩展点及仍需验证的异步授权传播、附件和流边界。未开放原生浏览器会话入口。
