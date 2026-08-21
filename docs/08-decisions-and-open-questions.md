# 架构决策与待定问题

## 1. 使用方式

本文件是产品级决策索引。稳定且影响长期架构的决定单独写入 `docs/adr/`；仍需用户、业务或技术验证的问题保留在本文。实施不得把“待定”静默当成默认决定。

状态：

- **决定**：当前实施必须遵守；
- **建议**：已有推荐，但需要负责人批准；
- **待验证**：需要 spike、原型或数据；
- **推迟**：不阻断当前阶段，到指定阶段再决策。

## 2. 已决定

| ID | 决定 | 依据 |
|---|---|---|
| D-001 | ORYH AI Client 使用独立仓库；DSH 是精确锁定的外部运行时 | [ADR-0001](adr/0001-dsh-integration-strategy.md) |
| D-002 | 只有缺少扩展点或必须紧急修复时才维护 DSH fork | [ADR-0001](adr/0001-dsh-integration-strategy.md) |
| D-003 | ORYH 和模型凭据不得进入模型上下文、Session 和 Renderer | [ADR-0002](adr/0002-credentials-outside-model-context.md) |
| D-004 | 生产凭据使用 OS Keychain/Credential Manager，不使用 DSH YAML 文件 | [ADR-0002](adr/0002-credentials-outside-model-context.md) |
| D-005 | 一个 Session 固定绑定一个租户连接 | [ADR-0003](adr/0003-tenant-bound-sessions.md) |
| D-006 | 切换企业会切换 Session namespace，不在同一会话替换 token | [ADR-0003](adr/0003-tenant-bound-sessions.md) |
| D-007 | 首版通过 REST 使用 ORYH；MCP 是未来可替换 transport，不阻断 MVP | [技术架构](04-technical-architecture.md#103-rest-与未来-mcp) |
| D-008 | 生产 Profile 禁用 Bash、通用 HTTP、任意文件、终端、LSP 和自修改 | [安全设计](05-security-and-privacy.md#7-prompt-injection-防护) |
| D-009 | Skill 保存判断层；认证、刷新、重试、幂等和参数编码在确定性工具层 | [能力映射](02-capability-map.md#1-分层规则) |
| D-010 | ORYH Console 保持完整管理面，客户端通过可信深链协作 | [体验设计](03-experience-design.md#11-console-分工与深链) |
| D-011 | DSH 工具执行批准与 ORYH 正式业务审批是独立概念和交互 | [体验设计](03-experience-design.md#73-两类批准必须分开) |
| D-012 | 真实租户上线前必须使用无凭据 Skill 内容和加密本地 Session | [安全设计](05-security-and-privacy.md) |
| D-013 | 交互客户端不承担 Hosted Flow Runner 的常驻多租户流程执行 | [能力映射](02-capability-map.md#12-流程推进-skills) |
| D-014 | 已知操作直接执行确定性 Operation；按钮、视图和 AI Tool 共享实现 | [ADR-0004](adr/0004-deterministic-operations-before-model.md) |
| D-015 | ORYH 账号认证只在系统浏览器；设备授权、本地解锁和 R4 step-up 是不同机制 | [ADR-0005](adr/0005-separate-account-auth-device-grant-local-unlock-and-step-up.md) |
| D-016 | 日常启动不重复 ORYH 登录；本地解锁后刷新/验证当前连接，`/auth/me` 成功才进入 Ready | [认证设计](09-authentication-and-login.md#4-日常启动状态机) |
| D-017 | 断开企业先服务端吊销当前设备，再删除本地凭据；锁定、断开、删除数据和浏览器退出不混用 | [认证设计](09-authentication-and-login.md#8-锁定断开与卸载) |
| D-018 | R4 重新认证必须由 ORYH 服务端 challenge 和最终验证，本地生物识别只能作为附加控制 | [认证设计](09-authentication-and-login.md#7-高风险操作的重新认证) |
| D-019 | ORYH AI Client 是第一方优化/参考客户端，不是员工使用 ORYH 的强制入口；兼容 Agent 继续存在 | [产品蓝图](10-oryh-product-model-and-client-blueprint.md#9-客户端产品主张) |
| D-020 | 一级业务模块由 capability、eligible Skill 与租户功能派生，不按固定角色名硬编码 | [ADR-0006](adr/0006-capability-derived-workspaces-and-business-thread-projections.md) |
| D-021 | 跨单据“业务线程”是沿显式外键/typed links 的只读可重建投影，不引入客户端 Case 真相 | [ADR-0006](adr/0006-capability-derived-workspaces-and-business-thread-projections.md) |
| D-022 | UI 与 Session 区分存储事实、服务端派生值、Agent 结论和未执行 proposal；结论记录规则依据版本 | [产品蓝图](10-oryh-product-model-and-client-blueprint.md#6-四类信息必须分开显示) |
| D-023 | Operation 分为 Query、Draft、Lifecycle、Human decision、Ledger、Governance、Batch 与 Automation 类别，类别决定确认/恢复策略 | [产品蓝图](10-oryh-product-model-and-client-blueprint.md#12-operation-分类) |
| D-024 | 开放 todo 和业务线程通过状态式重新读取收敛；推送/通知只降低延迟，不作为真相源 | [技术架构](04-technical-architecture.md#74-工作空间业务线程与状态收敛) |
| D-025 | 当前通用审批仍是 approval fact 与 todo completion 两步；客户端以 todo 为入口并处理部分成功，但不把它宣称为服务端原子保证 | [安全设计](05-security-and-privacy.md#92-部分成功) |

## 3. 建议等待批准

### Q-001 首发平台顺序

- 状态：建议
- 建议：开发先在 macOS 完成纵向切片；MVP 把 Windows 和 macOS 都作为支持平台，但如果桌面基础拖延，先对一个平台做受控试点，不能把另一平台标为支持。
- 原因：当前开发环境是 macOS，但企业终端通常包含大量 Windows；OS credential、签名和更新差异需要早期验证。
- 最晚决定：阶段 0 结束。
- 负责人：产品与桌面工程。

### Q-002 桌面壳选择

- 状态：待验证
- 建议：以 Electron 为默认候选。DSH Host 是 Node、UI 是 React，可以最少桥接；用一个 spike 比较 Electron 与 Tauri + Node sidecar 的启动、包体、签名、更新、Keychain、崩溃和 IPC 安全。
- 不接受的决定方式：仅依据包体大小或技术偏好。
- 最晚决定：阶段 V 结束。
- 负责人：桌面工程与安全。

### Q-003 模型供应方式

- 状态：建议
- 建议：技术验证允许专用测试 Provider key；受控 MVP 同时设计用户自带 key 与企业模型网关，但企业正式部署优先网关。
- 需要业务输入：由 ORYH 提供模型额度，还是由每个租户/用户承担；数据地域、账单和供应商条款。
- 最晚决定：阶段 F 结束。
- 负责人：产品、商业、安全。

### Q-004 默认 Session 保留期

- 状态：待验证
- 建议：普通业务 Session 默认 30 天，高敏感工资/付款 Session 默认不建立全文搜索并采用更短保留；企业策略可缩短或禁止持久化。
- 需要验证：用户返回历史会话的真实频率、合规要求和本地存储成本。
- 最晚决定：阶段 F 结束。
- 负责人：产品、隐私、试点租户。

### Q-005 无凭据 Skill API 形式

- 状态：建议，MVP 阻断
- 建议：保留 `/my/skills/manifest`，新增按当前 user credential 返回 eligible canonical content 的 endpoint；内容和 references 不渲染 access token，支持 hash/ETag 和按名称获取。不要让客户端先下载含 token ZIP 再正则清理。
- 需要后端决定：单个 Skill endpoint、无凭据 ZIP，或两者同时提供；如何表示 include 后的内容。
- 最晚决定：阶段 0 结束。
- 负责人：ORYH backend 与客户端架构。

### Q-006 本地 UI 通信

- 状态：待验证
- 候选：Electron IPC/custom protocol；受认证 loopback；Tauri command + Node sidecar protocol。
- 选择标准：Renderer 无凭据、来源认证、schema、stream、重连、Session event replay、测试和更新复杂度。
- 最晚决定：阶段 V 结束。
- 负责人：桌面工程与 DSH 集成。

### Q-007 正式确认位置

- 状态：待验证
- 候选：对话中的完整卡片；固定右侧详情面板；高风险动作 modal + 详情面板。
- 需要原型测试：长单据、窄屏、键盘、屏幕阅读器、跨企业误操作。
- 最晚决定：M1 设计冻结。
- 负责人：UX 与安全。

### Q-008 本地草稿是否默认同步到 ORYH

- 状态：建议
- 建议：模型抽取的初始内容先作为本地草稿；用户允许保存后才创建 ORYH draft。对长流程提供自动保存到服务端的显式设置，不默认静默写入。
- 原因：减少无意产生垃圾记录，同时保留恢复能力。
- 最晚决定：M1 设计冻结。
- 负责人：产品与目标用户。

### Q-009 高风险动作重新认证

- 状态：推迟到 B2
- 已决定：凡是依赖“近期 ORYH 身份认证”保证的动作，必须使用服务端 step-up；设备生物识别/系统认证只作为本地附加控制，双人控制属于服务端业务流程。
- 仍需决定：哪些付款、核销、权限和批量导入动作要求何种认证方法、`max_age` 和双人控制。
- 前置：ORYH 服务端提供 challenge、短期 assurance 和最终写入验证，不能只靠客户端 modal。
- 负责人：安全、财务业务和 ORYH backend。

### Q-010 企业策略来源

- 状态：推迟到桌面 MVP
- 候选：签名本地策略、MDM、ORYH 用户策略 endpoint，或组合。
- 不变量：策略可以进一步收紧客户端能力，不能下发秘密或关闭租户/凭据核心守卫。
- 负责人：企业平台与 ORYH backend。

### Q-011 用户是否可以安装第三方 DSH 插件

- 状态：建议
- 建议：生产 ORYH 客户端不提供任意插件安装；只加载 ORYH 签名插件。租户可发布 Skill 数据但不能分发原生代码。
- 原因：第三方插件与 Host 同进程时可触及凭据和业务数据，企业客户端无法把它当普通扩展市场。
- 最晚决定：阶段 F。
- 负责人：产品与安全。

### Q-012 跨企业只读汇总

- 状态：推迟
- 建议：MVP 完全不支持。未来如果用户明确需要“汇总两家公司今天的个人待办”，应由独立的聚合会话/进程逐租户读取、严格标注来源，并禁止写工具；不能放宽普通 Session 单租户不变量。
- 负责人：产品与安全。

### Q-013 ORYH 浏览器身份提供方

- 状态：建议，企业正式发布前决定
- 建议：客户端始终使用系统浏览器；ORYH hosted edition 优先接入企业 OIDC/SAML SSO，并支持 MFA/Passkey。客户端只消费 device approval 和 step-up 结果，不集成某一家 IdP SDK。
- 需要决定：首批租户的 IdP、账号恢复、MFA 强制策略、recent-auth 窗口和 standalone edition 的回退方式。
- 最晚决定：阶段 F 结束；涉及 R4 的 assurance 语义最晚在 B2 开始前冻结。
- 负责人：ORYH identity、安全与试点租户 IT。

### Q-014 首个纵向业务弧

- 状态：建议
- 建议：以“我的工作 → 费用申请/附件 → 审批 todo → 业务线程”为首个完整业务弧；工时作为第二个较简单复用验证。先证明 evidence、部分成功、状态收敛和无模型刷新，再扩展请假/资源。
- 原因：费用同时覆盖附件、Agent 抽取、服务端草稿、正式提交、审批与跨记录追踪，能更早暴露真实产品问题；不在 MVP 内提前开放付款/核销。
- 最晚决定：阶段 0 结束。
- 负责人：产品、ORYH 业务负责人和客户端技术负责人。

### Q-015 业务线程首批关系边

- 状态：建议
- 建议：阶段 V/M 只实现费用/审批关系；B1 增加 quote-to-cash、procure-to-pay 和 custom typed links；B2 增加 reimbursement/payroll 到付款。每条边必须有服务端字段、可见性和分页契约，不能靠模型相似度。
- 需要后端决定：哪些详情响应应直接返回关系 id，哪些使用专用有界查询；是否需要统一 relation endpoint。
- 最晚决定：对应阶段设计冻结。
- 负责人：ORYH backend、领域负责人和客户端架构。

## 4. 产品研究清单

| 研究问题 | 方法 | 阻断阶段 |
|---|---|---|
| 用户能否理解本地草稿/服务端草稿 | 可点击原型 + 任务测试 | M1 |
| 用户是否一直注意到当前企业 | 多企业误导测试 | M1 |
| 对话卡和详情面板何者适合审批证据 | 审批人任务测试 | M2 |
| 工具批准与业务审批是否仍会混淆 | 术语/组件对比测试 | M2 |
| 何时用户主动进入 Console | 试点埋点 + 访谈 | B1 |
| 历史会话的实际价值与保留要求 | 日记研究 + 企业访谈 | F/D |
| 企业是否接受 BYOK | 商业/安全访谈 | D |
| 能力派生工作空间是否比固定角色菜单更可理解 | 同角色不同能力的原型对比 | M1 |
| 用户能否分清 status、approval、开放 todo 和可能后续节点 | 业务线程任务测试 | M2 |
| 四类真相和“查看依据”是否能阻止建议被误认成结果 | 费用/审批原型与理解测试 | M1/M2 |

研究事件不记录业务正文，只记录任务类型、时间、步骤和结果类别。

## 5. 架构 spike 清单

| Spike | 输出 | 阻断 |
|---|---|---|
| DSH out-of-tree Profile/Plugin | 无核心修改的最小 ORYH 组装 | V |
| OS credential provider | 一个目标平台的 set/get/rotate/delete 与攻击测试 | V |
| 启动认证与本地解锁 | OS user presence、锁屏/睡眠、离线只读、`/auth/me` 和 reconnect 状态机 | V |
| Refresh crash safety | bundle 原子替换、single-flight、响应丢失、保存前崩溃和 grace 超时 | V/F |
| Device revoke/management | 当前设备断开、其他设备吊销、ownership 负向测试 | F |
| Tenant-bound Session scope | A/B 工具、Skill、context 和 replay 隔离 | V |
| Shared Operation registry | “我的待办”按钮和 AI Tool 共享执行；刷新时模型调用为零 | V |
| Tool proposal/approval binding | args digest、过期、参数变化、重放 | V |
| 无凭据 remote Skill provider | manifest/hash/LKG/tenant isolation | F |
| Encrypted Session provider | replay、索引、删除、损坏恢复 | F |
| Electron vs Tauri | 决策报告和安全/发布 PoC | D |
| Renderer transport | 来源认证、stream、取消、崩溃恢复 | D |
| OpenAPI generation | snapshot diff 和一个领域工具生成/适配 | F |
| Capability-derived workspace registry | `/auth/me` + manifest/reach 变化后的模块收敛和无提权 | V/F |
| Business-thread projector | 显式关系、局部失败、分页、重建和零模型刷新 | V/M1 |
| Evidence packet/proposal digest | 事实与 Skill/Policy/Workflow 版本变化后的确认失效 | M1/M2 |

Spike 代码是可丢弃验证；如果进入产品，必须重新满足正式包、文档和测试要求。

## 6. 变更决策流程

出现以下情况时新增 ADR：

- 修改租户、Session、凭据或本地数据不变量；
- 选择桌面框架、模型网关或企业策略协议；
- 需要 DSH fork 或 agent loop 修改；
- 把 Console 功能迁入客户端；
- 开放通用网络、文件、第三方插件或无人值守执行；
- 变更高风险确认、审计或幂等策略；
- 改变 Skills 与工具的职责边界。
- 新增业务线程的推测关系、持久业务实体或跨租户聚合方式；
- 改变 capability/audience 到工作空间和工具目录的计算规则；
- 改变事实、服务端派生值、Agent 结论与 proposal 的记录或展示语义。

ADR 必须写清背景、决定、替代方案、正负后果和重新评估条件。
