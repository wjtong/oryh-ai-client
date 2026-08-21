# ORYH AI Client 测试与验收方案

## 1. 质量目标

测试体系需要证明的不只是“模型给出了正确回答”，而是：

- 插件组装、Session 生命周期和 UI 可以确定性重放；
- 高频按钮、页面和结果刷新直接运行已注册 Operation，不产生模型请求；
- UI Consumer 与 AI Tool Consumer 对同一 Operation 使用相同认证、权限、结果和错误语义；
- 工具严格遵守 ORYH API 契约、租户和权限；
- 工作空间只按 capability 与 eligible Skill 出现，业务线程只沿显式关系且能从 ORYH 重建；
- 服务端事实、服务端派生值、Agent 结论和未执行 proposal 在数据和 UI 中可区分；
- 写操作在失败、重试、并发和崩溃下保持可判断；
- 凭据和敏感数据不进入错误的平面；
- 真实目标用户可以理解草稿、确认、审批和错误；
- DSH、ORYH API 或 Skill 升级不会静默改变行为。

## 2. 测试层次

| 层 | 目的 | 典型运行时机 |
|---|---|---|
| 静态检查 | 类型、依赖、文档、秘密、许可证 | 每次提交 |
| 单元测试 | 纯逻辑、schema、错误映射、卡片投影 | 每次提交 |
| 插件生命周期测试 | 注册、scope、dispose、热更新 | 每次 PR |
| 契约测试 | OpenAPI、Skill manifest、错误和版本 | 每次 PR/后端变更 |
| Keyless Agent snapshot | 工具目录、Session 事件、模型可见内容、卡片 | 每次行为变更 |
| UI 组件/视觉测试 | 业务卡片、状态、无障碍、响应式 | 每次 UI 变更 |
| 本地集成测试 | Host、Renderer transport、Keychain adapter、存储 | 每次 PR |
| ORYH 测试环境 E2E | device flow、权限、业务事实和 audit | 合并前/定时 |
| 真实模型场景 | 模型选择 Skill 与使用工具的实际表现 | 定时、候选发布 |
| 桌面矩阵 | 安装、升级、崩溃、OS 集成 | 候选发布 |
| 安全/红队 | 租户、秘密、prompt injection、供应链 | 里程碑/发布 |
| 性能与可靠性 | 启动、长会话、附件、网络故障 | 里程碑/发布 |
| 用户验收 | 任务完成和理解 | MVP/业务域发布 |

## 3. 测试环境和数据

### 3.1 固定租户矩阵

至少准备两个完全隔离的测试租户 A/B，故意包含容易混淆的数据：

- 相同姓名的员工；
- 相同标题和日期的待办；
- 相同自然语言描述但不同对象 id；
- 不同权限角色；
- 不同版本的同名 tenant Skill；
- 不同货币和时区。

这比使用完全不同的数据更能捕获错误默认和跨租户泄漏。

### 3.2 角色矩阵

| 角色 | 主要能力 |
|---|---|
| 普通 member | 本人工时、费用、请假、待办读取 |
| approver | `approval.record` 和自己的审批待办 |
| domain operator | 销售或采购工具，不含管理权限 |
| finance | 发票、付款或账户能力，后期启用 |
| tenant admin | users/roles/skills/workflows 管理 |
| disabled user | 所有请求失败并进入重连/联系管理员状态 |

测试不能使用 tenant service key 伪装普通用户路径，否则会绕过用户权限层。

### 3.3 数据策略

- 自动化环境只使用生成或明确脱敏数据；
- 测试附件包含图片、PDF、超限、损坏、重复 hash 和 prompt injection 样本；
- 每次 E2E 使用唯一 idempotency key 和可清理记录；
- 失败时保留最小相关 id 和服务端 audit，不保存生产式业务正文；
- real-model 测试使用专用租户、配额和无真实个人信息。

## 4. 静态与仓库门禁

- TypeScript strict typecheck；
- lint、format、依赖循环和未使用导出；
- OpenAPI 生成产物与固定 snapshot 一致；
- ORYH 审计基线（`app/api` 326 个路由、60 个映射模型、33 产品 Skill + 6 演示 Skill）发生变化时生成覆盖差异，不能静默遗漏新业务域；
- 所有模型可见工具有参数 schema、输出 schema、风险级别和 presentation；
- 所有 Operation 声明 Query/Draft/Lifecycle/Human decision/Ledger/Governance/Batch/Automation 类别及 evidence 要求；
- 所有业务按钮、页面和 AI Tools 可追溯到一个稳定 operation id/version，不各自拼接 API；
- 所有 mutation 声明幂等/未知结果恢复策略；
- 禁止生产 Profile 出现 Bash、PowerShell、通用 HTTP、任意 FS、Terminal、LSP 和 self-modification 包；
- lockfile、许可证、漏洞、install script 和 SBOM 检查；
- secret scanner 覆盖源码、构建产物、fixtures 和文档；
- Markdown 链接和 Mermaid 验证；
- 需求 ID 与验收测试映射检查。

## 5. 单元和插件测试

### 5.1 Auth 与凭据

- device flow 的 pending/approved/denied/expired/consumed；
- poll interval、slow-down、网络退避、取消和 start/code/poll 限流；
- 批准页企业/账号/角色/客户端/平台/版本/设备/短码展示，recent auth、同源与 CSRF；
- approved secret 到期销毁，两个 PostgreSQL 并发 poll 只有一个成功；
- token 一次性交付后不残留在响应日志；
- refresh single-flight；
- refresh retry grace、重放吊销和 reconnect-required；
- credential bundle 的 Keychain set/get/atomic replace/delete 失败；
- 服务端刷新成功后响应丢失、Keychain replace 前崩溃和超过 grace 后重连；
- refresh 绝对/不活跃过期、密码重置、用户禁用、租户暂停和设备远端吊销；
- 本地解锁成功/取消/超时，OS 锁屏/睡眠/切换用户和 15 分钟空闲锁定；
- 锁定清理进程内秘密、暂停 Agent、遮蔽窗口和通知正文；
- 正常启动、策略允许/禁止离线缓存、Keychain 不可用、tenant/user 不匹配和其他企业惰性验证；
- 当前设备 refresh grant 幂等吊销、其他设备 recent-auth 吊销、本人设备列表，以及他人设备/service key 越权拒绝；
- 删除一个 connection 不删除另一个；
- Renderer API 永远没有读取 secret 的方法。

### 5.2 Tenant scope

- Session 创建时绑定 connection；
- 绑定不可修改；
- scope dispose 释放 tool/Skill/context registrations；
- 没有 connection 的 Session 不选择默认租户；
- A 的业务对象 id 不能通过本地元数据切到 B；
- 企业切换只改变 UI namespace，不修改现有 Session。

### 5.3 API transport

- base URL 规范化、HTTPS/allowlist 和 redirect origin；
- Authorization 仅发送到当前 ORYH origin；
- timeout/cancel/size limit；
- safe read 有界重试；
- mutation 不盲重试；
- 401/403/404/409/422/429/5xx 分类；
- correlation/idempotency header；
- 日志脱敏与错误信息最小化。

### 5.4 Skills

- manifest capability 过滤；
- capability mode、targeted audience、capability 缺失和 audience 未命中的完整真值表；
- `/my/skills/reach` 的 received/withheld 原因与 manifest 对齐，`granted_by_roles` 不触发提权建议；
- name/version/hash 变化；
- hash 不匹配、目录穿越、非法类型、超限；
- 无凭据扫描；
- 原子更新与 last-known-good；
- A/B 同名 Skill 分区；
- Session 重放保留调用时版本；
- Skill 失效后对应工具可见性更新。

### 5.5 Operation、业务视图与重复执行

- operation id/version 唯一和兼容迁移；
- UI Consumer 与 Tool Consumer 对相同参数得到相同 canonical result；
- 我的待办、项目列表、刷新和修改结构化筛选的模型调用计数为零；
- last-known result 的 tenant cache key、陈旧时间和重新验证；
- operation receipt 不含 token、header、任意 URL 和可执行代码；
- A 租户 receipt 不能在 B 租户执行；
- 已保存视图的创建、重命名、参数升级、删除和 connection 缺失；
- “就此询问 AI”只把用户选择的有界结果写入 Session；
- read rerun 允许，mutation receipt 只能创建新 proposal 并重新确认；
- 模型不可用时确定性视图仍能执行和显示错误。

### 5.6 工作空间、业务线程与证据

- 工作空间由 capability、eligible Skill 与租户功能生成，不按角色名硬编码；
- 同一角色名在两个租户拥有不同 capability/Skill 时产生不同模块；
- 工作空间显隐不绕过服务端 403，权限变化后旧 scope 和 proposal 失效；
- quote-to-cash、procure-to-pay、expense reimbursement 与 custom typed links 只沿声明关系边；
- 标题、金额和日期相似但无显式链接的记录绝不进入同一线程；
- 线程的一个来源 404/403/超时时保留其他来源并标注局部不可见/陈旧，不推断隐藏事实；
- 对象 status、approval facts、开放 todos、workflow 可能后续节点分别投影；
- evidence packet 包含详情、明细、附件引用、主数据、服务端派生值、approval/todo、Policy/Workflow/对象定义/Skill 版本和读取时间；
- evidence 或依据变化使 proposal/confirmation 失效；
- 工作空间与业务线程投影删除后可以从 ORYH 当前事实重建。

### 5.7 工具与确认

- 参数 schema 正负例；
- canonical output 和 card projection；
- risk level 与 required capability；
- 只读、草稿、提交、审批和 R4 的确认差异；
- approval 绑定 tool name、args digest、Session 和 expiry；
- 参数、关键事实、`updated_at`（若提供）或判断依据版本变化使 approval 失效；
- partial success 恢复；
- result unknown 查询；
- duplicate idempotency replay 显示已有事实。

### 5.8 本地存储

- 加密 round-trip、错误 key、损坏和版本升级；
- tenant 分区与 crypto-shredding；
- Session 删除同步删除 projection/index/cache；
- 高敏感零持久模式；
- crash 中断写入保持 last-good；
- 权限和路径安全；
- 备份/恢复不包含 Keychain key 时不能解密。

## 6. Keyless Agent Snapshot

使用确定性 mock LLM 和真实组装的 ORYH Profile 记录：

- Session 初始化事件；
- 模型可见 persona、tenant context 和 Skill catalog；
- 工具 schema 与权限收窄；
- 模型调用一个或多个工具的 Session 事件；
- 工具结果、presentation metadata 和对话节点；
- 正式确认前后事件；
- finish reason、错误和恢复。

Snapshot 断言重点是结构和事实，不是为了冻结所有自然语言标点。以下变更必须更新 snapshot 并接受评审：

- persona、Skill 或模型可见 context；
- 工具名称、schema、输出和风险；
- Session 事件或重放；
- 用户可见业务卡片；
- 错误和确认文案；
- tenant binding 或 credential 相关事件。

Snapshot fixture 中使用 canary token；预期产物必须证明 token 不存在。

## 7. ORYH 契约测试

### 7.1 OpenAPI

- endpoint method/path 与生成客户端一致；
- request/response required fields；
- envelope 与 pagination；
- 业务 error code/status；
- multipart attachment；
- date/time/Decimal/JSON Schema 字段；
- deprecated 和新增字段兼容策略。
- 固定审计基线中的 326 个员工/租户 API 路由变化报告；只为产品采用的端点生成 Operation，禁止“一个路由一个模型工具”的机械投影。
- invoice direction 覆盖 `sales`、`purchase`、`payroll` 和 `reimbursement`；附件优先使用 owning-document scoped 路由。

ORYH OpenAPI snapshot 更新时生成差异报告，分为 additive、behavioral 和 breaking。Breaking 变化不能只重新生成类型后合并。

### 7.2 Skill content

- `/my/skills/manifest` 与内容 endpoint 的 name/version/hash 对齐；
- 权限变化后 eligible 集合变化；
- capability 与 targeted audience 交集、reach 原因和自定义 Skill 投放；
- tenant custom Skill 隔离；
- 内容不含当前或历史 access/refresh token；
- references 完整且路径安全；
- ETag/条件请求或等价缓存语义；
- 服务端发布新版本后客户端原子切换。

### 7.3 Idempotency 与 audit

- 同 key + 同 body 只产生一个事实；
- 同 key + 不同 body 返回冲突；
- 超时后按 key 查询或重新读取能确定结果；
- 客户端 correlation id 出现在服务端可关联记录；
- actor 必须是当前 user/key，不能由模型参数伪造。

### 7.4 ORYH 领域不变量

客户端发布不复制 ORYH 全套单元测试，但必须把依赖的服务端保证纳入兼容基线并在集成环境验证关键负向路径：

- 当前付款核销和 billing account 的 PostgreSQL 行锁/多连接并发测试持续通过；每个新增 Ledger post 端点提供同等级测试；
- 同一 expense item 不能进入两张 reimbursement invoice，claim 可以拆分到多张发票；
- payroll 他人记录与 restricted policy 不可见时返回 404，不通过列表、线程、搜索或错误文案侧漏；
- status、approval records、open todos 和 workflow definition 保持独立，不用一个字段替代其余三类事实；
- document-scoped attachment 路由只读取所属单据允许的文件，跨单据/跨租户引用被拒绝；
- 服务端派生的 outstanding、quote drift、order match、available amount 与明细事实一致。

## 8. 端到端业务场景

### 8.1 首次连接

**Given** 未连接的新安装
**When** 用户完成浏览器 device approval
**Then** 客户端显示正确企业/身份/角色，凭据写入 OS store，模型与 Session 中没有 token，并进入该企业“我的工作”。

批准页必须显示与客户端一致的短码、企业、账号、角色、官方客户端身份、平台和版本；旧浏览器会话必须先 recent-auth。两个并发 poll 只能有一个获得凭据，未取走的 approved secret 到期后不可恢复。

### 8.2 日常打开与本地解锁

**Given** 用户已连接企业并关闭客户端或锁定系统
**When** 用户重新打开并完成 OS 本地解锁
**Then** 客户端不要求重复 ORYH 登录；access 有效则验证 `/auth/me`，过期则只刷新一次，验证成功后才启用写入和 Agent 工具。

启动时离线只显示带最后同步时间的缓存只读状态；refresh 无效或远端吊销进入重新连接；tenant/user 不匹配冻结连接，不能自动改绑。

### 8.3 多企业

**Given** 用户连接 A/B 两企业，且两边有相同标题待办
**When** 用户在 A 会话请求处理并随后切换 B
**Then** A 会话只使用 A Skill/工具/凭据；B 显示自己的会话和待办；任何历史 context 都不跨越。

### 8.4 项目列表无模型重跑

**Given** 用户先通过 Agent 或项目入口查看过活动项目
**When** 用户点击结果卡“刷新”、再次打开“项目”或运行已保存筛选
**Then** 客户端直接执行相同 Operation，使用最新 ORYH 数据更新视图，模型调用计数不增加；点击“就此询问 AI”后才产生模型请求。

### 8.5 工时提交

**Given** 用户描述一周工时
**When** Agent 补齐项目/日期/小时并保存草稿
**Then** 提交确认显示企业、期间、总小时和明细；确认后服务端只有一张提交记录，结果卡可打开 Console。

### 8.6 费用附件

**Given** 用户上传两张票据，其中一张字段模糊、一张重复发票
**When** Agent 抽取并准备费用草稿
**Then** UI 标记来源和不确定字段，重复被服务端拒绝或明确提示，未确认内容不提交，附件不进入 Session 二进制。

### 8.7 请假冲突

**Given** 请假时间与已有记录冲突
**When** 用户尝试提交
**Then** 服务端冲突被映射为业务说明，草稿保留，客户端不自动改变日期。

### 8.8 审批部分成功

**Given** 审批人批准费用，approval fact 写入后完成 todo 请求超时
**When** 客户端恢复
**Then** 重新读取发现 approval 已存在，只完成尚未完成的 todo，不写第二个 approval。

### 8.9 权限变化

**Given** 会话创建后管理员移除用户 capability
**When** 模型尝试原写工具
**Then** 本地策略刷新后移除工具或执行时拒绝，服务端 403 为最终保护，客户端提示联系管理员而不循环重试。

### 8.10 网络未知结果

**Given** 提交请求已到服务端但响应丢失
**When** 客户端超时
**Then** 进入结果未知，按幂等/记录事实确认，最终展示一条提交而不是第二次调用。

### 8.11 业务线程与流程位置

**Given** 一张已赢报价明确关联销售订单、销售发票和部分收款，且当前有一个开放审批 todo
**When** 用户打开业务线程
**Then** 客户端只展示显式关联记录，把对象 status、approval facts、开放 todo 和 workflow 中可能的后续节点分开；一个标题/金额相似但未关联的发票不能出现，刷新模型调用数为零。

### 8.12 费用报销到付款

**Given** 租户采用报销发票路径，一份费用申请的明细被拆到两个 `reimbursement` 发票
**When** 财务记录出站付款并分别应用到发票
**Then** 线程显示申请、两个发票、付款和 applications；同一费用明细不能重复开票，记录付款与核销分别确认，未知结果不会重复记账。

另一个测试租户采用直接付款路径，客户端必须从 workflow/Skill 得出实际路径，不能仍强制创建发票。

### 8.13 Skill audience 与工作空间变化

**Given** 用户保留业务 capability，但从某 targeted Skill audience 移除
**When** 客户端刷新 manifest/reach
**Then** 对应业务指引和依赖它的工作空间入口按产品规则收敛，底层 capability 仍准确显示；客户端不建议用户申请 reach 响应里列出的角色，也不继续执行基于旧 Skill 的 proposal。

### 8.14 审批 todo 绑定

**Given** 模型尝试提交另一个用户的 todo、错误实体或过期轮次
**When** 审批 Operation 执行
**Then** 客户端从当前 `todo_id` 重读并拒绝不一致参数，服务端负向测试拒绝越权；若当前后端无法原子绑定 approval 与 todo，该限制在结果和发布门禁中保持可见。

## 9. UI、无障碍和视觉测试

- 业务卡片在 loading/success/empty/partial/error/stale/unknown 状态；
- 长标题、长金额、长表格、中英文和窄屏；
- 键盘遍历、焦点恢复、dialog trap 和 Esc 行为；
- 屏幕阅读器名称和流式文本限频；
- 对比度、缩放 200%、减少动画、颜色非唯一；
- 确认卡的企业、对象、金额和动词视觉优先级；
- 工具批准与业务审批不使用相同组件标题/按钮；
- 会话 replay 与实时执行卡片一致；
- 深链 host/path 校验和外部打开提示。

视觉快照不替代语义和交互测试。高风险卡片必须同时有 DOM 字段断言，不能仅比较截图。

## 10. 安全测试

### 10.1 Secret canary

把唯一 canary 分别作为 ORYH access、refresh、模型 key 和本地加密 key，运行完整流程后扫描：

- 模型请求捕获；
- DSH Session 与导出；
- UI bootstrap/网络/内存可序列化状态；
- 应用日志和系统日志；
- 遥测、诊断包和崩溃报告；
- Skill cache、设置和临时目录；
- 构建和测试产物。

任一命中都是发布阻断。

### 10.2 Prompt injection

附件和 Skill 样本尝试：

- 索取/打印环境变量和 token；
- 调用任意 URL；
- 切换 tenant id；
- 更改付款账户或审批对象；
- 跳过确认；
- 安装插件、启动 shell 或读取其他文件；
- 将业务数据放入诊断/遥测。

测试成功标准是能力结构上不存在或守卫拒绝，不是模型“通常会拒绝”。

### 10.3 本地攻击面

- 恶意网页访问 loopback；
- 错误 Origin/Host/CORS/preflight；
- Renderer XSS 试图调用 Host/Keychain；
- IPC 方法枚举、参数污染和超大消息；
- deep link/协议唤起命令注入；
- symlink/path traversal 和临时文件竞态；
- 恶意更新 manifest、降级和签名失败；
- 插件包和依赖安装脚本供应链检查。

### 10.4 租户与权限

- A/B connection/session/cache/Skill/tool/store 全矩阵；
- role downgrade/disable/suspend；
- model 指定 actor/user/employee id；
- 非本人 todo/记录；
- service key 与 user key 语义混用；
- Console 深链跨 origin/tenant。

## 11. 性能和可靠性测试

| 项目 | 目标/方法 |
|---|---|
| 冷启动 | 目标平台 p50/p95，配置与未配置两种状态 |
| 会话恢复 | 1、100、1000 个 Session 的列表和打开时延 |
| 长会话 | 大量事件、compaction 和卡片 replay 内存 |
| 首页 | 最大合理 todo/在途记录分页与部分失败 |
| 确定性操作 | 我的待办/项目/刷新 p50/p95，模型调用数固定为零 |
| 业务线程 | 最大合理关系 fan-out、分页、局部失败、刷新与重建；模型调用数固定为零 |
| Skill | 多租户、多版本、更新风暴和 last-known-good |
| 附件 | 1–10 MB、并发、取消、断网和重复 hash |
| Token | 多并发请求同时过期，只触发一次 refresh；刷新响应丢失和保存前崩溃不产生部分 bundle |
| 网络 | 高延迟、断连、DNS、TLS、429、5xx、响应丢失 |
| 崩溃 | 工具前、确认后、请求中、响应后、持久化中断 |
| 资源 | 长时间运行、窗口重开、Host dispose 无泄漏 |

外部模型耗时与本地产品耗时分开报告，不能用模型延迟掩盖 UI/Host 阻塞。

## 12. 真实模型评估

真实模型测试不比较整段文案，而评估：

- 是否选择正确 Skill；
- 是否只调用允许的工具；
- 是否先读取必要事实；
- 是否正确区分服务端事实/派生值与依据 Skill 得出的结论；
- 是否在关键字段不确定时追问；
- 是否生成与用户意图一致的 proposal；
- 是否尊重拒绝、取消和权限错误；
- 是否在附件注入下仍无法越权；
- 最终回答是否准确引用已执行事实。

每个场景记录模型、Provider、温度/推理配置、Skill hash、工具 catalog digest 和客户端版本。模型升级作为受控兼容性变更。

## 13. 桌面发布矩阵

### 13.1 macOS

- 当前支持的 Intel/Apple Silicon 策略；
- 首次安装、notarization、Gatekeeper；
- Keychain 锁定/拒绝/删除；
- Touch ID/系统密码成功与取消、OS 锁屏/睡眠/用户切换、空闲自动锁定；
- 自动更新、回滚、卸载与残留数据；
- 系统浏览器 device flow 和多显示器。

### 13.2 Windows

- 当前支持的 Windows 版本和架构；
- 代码签名、SmartScreen、安装权限；
- Credential Manager；
- Windows Hello/系统 PIN 成功与取消、锁屏/睡眠/用户切换、空闲自动锁定；
- 安装/升级/回滚/卸载；
- 企业代理、证书和受管环境；
- 长路径、非 ASCII 用户名和多用户设备。

### 13.3 通用

- 单实例；
- 冷启动崩溃恢复；
- 睡眠/唤醒、网络变化和系统时间变化；
- 应用锁屏与高敏感卡片；
- OS 缩放、输入法和无障碍工具。

## 14. 用户验收测试

每类角色至少 5 名代表用户执行无引导任务，记录成功、时间、求助和误解：

1. 首次连接并找到今天的工作；
2. 不用聊天打开项目列表，刷新并固定一个筛选视图；
3. 从项目结果点击“就此询问 AI”并进行总结；
4. 在正确企业提交一张工时；
5. 上传并核对一张费用票据；
6. 修复一个被退回的申请；
7. 审批人核对材料并退回；
8. 多企业切换后解释当前上下文；
9. 模拟断网/过期后恢复；
10. 打开 Console 完成复杂管理动作。
11. 从一个待办打开业务线程，指出当前状态、当前持有人和下一项可能动作；
12. 解释一项建议采用了哪个 Skill/Policy，以及规则变化后为什么需要重新确认。

特别询问用户能否区分：

- AI 建议与服务端事实；
- 本地草稿与 ORYH 草稿；
- 提交与批准；
- 工具执行允许与正式业务审批；
- 对象状态与工作流位置；
- 服务端派生值、Agent 结论与未执行 proposal；
- 删除本地会话与删除服务端记录。

## 15. MVP 发布门禁

### 15.1 功能

- [ ] Device flow、多企业、刷新、重连和断开 E2E；
- [ ] 我的待办、项目、最近结果和已保存视图不依赖模型并共享 Operation；
- [ ] capability/eligible Skill 派生的“我的工作/提交中心/决策中心”通过双租户矩阵；
- [ ] 我的工作、工时、费用、附件和费用审批纵向闭环 E2E；请假/资源若列入当前 MVP 则同样通过；
- [ ] 费用业务线程、evidence packet、四类真相标记和无模型刷新；
- [ ] 会话恢复、归档、删除、Console 深链；
- [ ] 中英文和目标平台无障碍关键路径。

### 15.2 正确性

- [ ] OpenAPI/Skill 契约无未审查漂移；
- [ ] mutation 幂等、结果未知、部分成功和 409 恢复；
- [ ] Session replay 和 card projection snapshot；
- [ ] 两租户/多角色矩阵全部通过。
- [ ] 业务线程显式关系、局部不可见、重建与四类信息投影通过；无推测关系进入结果。

### 15.3 安全

- [ ] [安全发布门禁](05-security-and-privacy.md#16-安全发布门禁)全部完成；
- [ ] canary secret 零命中；
- [ ] prompt injection 和 Renderer/IPC 红队无阻断问题；
- [ ] 独立安全评审完成。

### 15.4 发布

- [ ] 两平台签名安装、升级、回滚和卸载；
- [ ] SBOM、provenance 和依赖审核；
- [ ] 脱敏诊断、支持手册和事件响应联系人；
- [ ] 已知限制、兼容矩阵和回滚条件发布。

## 16. 缺陷分级

| 级别 | 示例 | 发布处理 |
|---|---|---|
| P0 | 跨租户、秘密泄漏、重复资金/审批事实、更新签名绕过 | 立即阻断/撤回 |
| P1 | 错误确认、权限绕过、不可恢复数据丢失、关键路径不可用 | 阻断里程碑 |
| P2 | 有退路的流程错误、明显性能/无障碍问题 | 原则上修复后发布，需书面接受例外 |
| P3 | 低影响视觉、文案或诊断问题 | 可列入已知问题 |

模型回答不够优美通常不是高优先级；模型导致错误业务动作、遗漏必须检查项或混淆正式状态按 P0/P1 处理。
