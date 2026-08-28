# ORYH 产品模型与客户端蓝图

状态：规划事实基线
日期：2026-08-21
ORYH 源码基线：`/Users/wtong/git/calwbiz`，commit `1ea1509`

## 1. 文档目的

本文把 ORYH 当前服务端、公共 API、产品 Skills、租户示例 Skills、需求文档、技术设计和真实 Agent E2E 结果整理成客户端必须遵守的产品模型。它不是 ORYH API 的重复说明，而是回答三个问题：ORYH 到底是什么、专属客户端应该原生承载什么、哪些事情仍属于 Agent、ORYH Console 或 Hosted Flow Runner。

审计时按以下优先级判断当前事实：

1. 当前代码、模型、迁移和测试；
2. 当前领域设计文档与 Skill 内容；
3. README 和演示数据说明；
4. 带明确日期的历史评审与 E2E findings，只作为变更背景，不能直接当成现状。

因此，2026-08-16 架构评审指出的财务并发丢失更新不能继续写成“当前未修复事实”：当前代码已经使用行锁，并有真实 PostgreSQL 多连接测试。与此同时，device secret 的原子单次交付、自助设备撤销、canonical 无凭据 Skill 内容和服务端 step-up 等仍可从当前代码确认尚未完成；其中 Skill content 可由客户端严格的 Host 内存 adapter 暂时绕开，其他项按对应风险仍是发布依赖。

## 2. 当前产品事实快照

以下数字只用于覆盖审计，不构成未来兼容承诺：

| 表面 | 当前规模 | 对客户端的意义 |
|---|---:|---|
| `app/api` 员工/租户路由声明 | 326 | 不能把 endpoint 一比一变成菜单或模型工具；全 `app` 另有平台与浏览器路由 |
| SQLAlchemy 映射模型 | 60 | 56 个核心/租户模型 + 4 个平台 SaaS 模型；ORYH 不是轻量 todo 服务 |
| 产品 Skills | 33 | 是岗位过程合同和判断来源，不应一比一变成页面 |
| 演示租户 Skills | 6 | 证明租户可在不发布后端和客户端的情况下增加行业过程 |
| API 路由模块 | 20 | 适合生成 transport 类型和契约测试，不适合直接决定信息架构 |

API 路由模块包括 auth、device、bundles、console、people、workspace、master data、resources、claims、objects、sales、purchasing、billing、policies、roles、skills、workflows、flows、flow-runner bootstrap 和 notifications。平台运营 `/admin` 不属于员工客户端权限面。

## 3. ORYH 的产品定位

ORYH 是面向 Agent 驱动业务过程的多租户企业事实与控制层，也可以描述为 agent-native system of record 或 headless ERP/CRM。它不是以下产品：

- 不是把传统 OA、ERP、CRM 全部页面搬到聊天框；
- 不是在后端解释所有自然语言规则的 BPM 引擎；
- 不是绑定某个模型或 Agent runtime 的专有 Agent 平台；
- 不是只保存会话记忆的个人助手；
- 不是通用财务总账、税务计算或工资计算引擎。

其运行关系是：

```text
人表达意图、补充事实并作出判断
  → 兼容且被企业允许的 Agent 理解材料和规则
  → Skill 规定过程、检查项、禁止事项和角色分工
  → ORYH API 执行身份、权限、租户、合法状态和数据完整性约束
  → ORYH 保存可持续查询的记录、审批事实、待办、关系、账本和审计
```

“Headless”不表示没有人类界面。日常执行可以由 Agent 操作，而配置、权限、审计、异常恢复和大规模浏览仍需要人类控制面。ORYH AI Client 是一款优化客户端和兼容性参考实现，不是使用 ORYH 的强制入口；同一公司仍可让不同员工使用其他经过验证的 Agent。

## 4. ORYH 的三个运行平面和一个事实核心

| 平面 | 责任 | 主要载体 |
|---|---|---|
| 员工执行平面 | 表达意图、查看个人工作、提交记录、作出审批决定 | ORYH AI Client 或其他兼容 Agent |
| 人类控制平面 | 配置人员、权限、对象、规则、Skills，浏览全局数据和审计 | ORYH Console |
| 自动化执行平面 | 按当前状态发现无人承接的工作，执行租户流程定义 | Hosted Flow Runner 或租户自管 Agent |
| 持久事实核心 | 身份、权限、记录、关系、账本、审批事实、待办、规则版本、审计 | ORYH 服务端与 PostgreSQL |

客户端可以读取自动化状态并帮助诊断，但不能在员工电脑上默默成为常驻 Flow Runner。客户端可以深链 Console，但不能复制完整的租户管理控制面。

## 5. 核心概念

### 5.1 Tenant、Identity、Credential 和 Session

- 一个 tenant 表示一家企业，服务端从凭据决定 tenant；客户端和模型都不能用请求参数切换企业。
- user-bound key 表示一个人的实时角色权限；tenant service key 表示企业自己的自动化身份并绕过普通权限；hosted flow agent key 是 ORYH 托管的固定窄权限主体。
- 一个客户端连接对应一个 origin、tenant、user 和安装实例；一个 Agent 可以连接多家企业，但每个业务 Session 永久绑定一个连接。
- 浏览器账号认证、设备连接授权、本地客户端解锁和高风险 step-up 是四个不同过程。

### 5.2 Capability、Role、Skill 和 Audience

- capability 回答“服务端是否允许这个动作”；系统 capability 可以直接保护 API，租户自定义 capability 只用于 Skill 分发和流程资格。
- role 是权限授予单位，一个用户当前只持有一个角色。
- Skill 是 Agent 的过程合同，包含触发条件、判断、检查顺序、禁止事项和交接；安装 Skill 本身不授予权限。
- Skill audience 回答“这份 Skill 发给谁”，只能在 capability 已允许的集合上继续收窄，不能授予权限。
- targeted 模式的空 audience 表示发给零人。有效 Skill 集合是当前 capability、当前 audience、Skill 状态和客户端支持能力的交集。
- `/my/skills/reach` 可以解释 Skill 为什么收到或未收到；客户端应显示全部 blocker，不能把 `granted_by_roles` 误解为建议用户申请更高角色。

### 5.3 Object、Lifecycle、Workflow、Approval 和 Todo

- object status 只表示对象生命周期，不表示审批走到哪个节点。
- 已通过节点来自 append-only approval records；当前责任人来自 open todos；可能的下一步来自当前 workflow definition。
- 同一节点可以在新轮次再次出现，也可以并行审批，而无需发明更多状态。
- 人的审批动作是“写一个审批事实并完成自己的 todo”；创建下一节点、改变终态和发送通知属于流程 Agent。
- 工作队列是当前状态查询，例如 `without_open_todo=true`，不是依赖游标的事件消费。丢失一次唤醒只增加延迟，下一次扫描仍会发现工作。

### 5.4 Policy、Workflow Definition、Object Type Definition 和 Skill

这四类租户数据不能混为一谈：

| 租户数据 | 回答的问题 | 变更方式 |
|---|---|---|
| Policy | 公司规则和外部标准是什么 | 发布新版本，按有效日期查询 |
| Workflow definition | 这种记录如何校准、路由和终结 | 发布新版本，旧版本可追溯 |
| Object type definition | 字段、JSON Schema 和生命周期词汇是什么 | 修改定义和状态角色映射 |
| Skill | Agent 以什么步骤、工具和禁止事项执行工作 | 更新产品校准或发布租户 Skill |

客户端在提出重要建议或提交正式动作时，应保存或展示实际使用的 policy code/version、workflow definition id/version、object type definition version、Skill name/version/hash、记录 `updated_at` 和读取时间。当前对象 API 普遍没有统一 ETag/version，客户端不能伪造一个不存在的 record version。

## 6. 四类信息必须分开显示

ORYH 的产品特性建立在“事实与结论分离”上。客户端必须区分：

| 类型 | 示例 | UI 语义 |
|---|---|---|
| 持久事实 | 单据行、审批记录、open todo、核销行、政策正文 | ORYH 事实 |
| ORYH 从当前事实派生的数值 | outstanding amount、quote drift、order match、available amount、computed total | ORYH 派生值，显示计算口径和刷新时间 |
| Agent 根据规则作出的结论 | 请假余额、三单差异是否可接受、工资税费、积分兑换金额、下一审批人 | Agent 判断，必须引用输入事实和规则版本 |
| 用户尚未确认的 proposal | 抽取字段、拟提交付款、拟改角色 | 未执行草案，不能冒充 ORYH 状态 |

典型约束：

- 请假余额不存储；Agent 根据有效政策、hire date、已批准和在途请假计算，并展示算式与政策版本。
- 工资不由服务端计算；每个工资行必须引用 pay history 或记录可复核算式。
- 三方匹配由服务端报告 ordered、received、billed 和 variance，但容差由租户规则决定。
- 积分和钱永不由服务端转换；“500 分抵 5 元”是积分负向流水和发票 discount 两个事实。
- 结算不是状态；以 append-only payment applications 和 outstanding amount 为准。

## 7. 主要业务弧

客户端不应只显示孤立单据，应在已有显式关系上构建只读“业务线程投影”。这不是新的服务端实体，也不能补造不存在的关系。

### 7.1 Quote-to-cash

```text
客户/项目/产品与价格
  → 报价及修订链
  → 成交报价
  → 销售订单与报价差异
  → 销项发票及订单行匹配
  → 收款
  → payment applications
  → outstanding / collected
  ↘ 可选 billing account 占用与余额
```

### 7.2 Procure-to-pay

```text
采购申请及不确定项
  → 批准
  → 采购订单与申请行回链
  → 收货事实与库存台账
  → 进项发票及三方匹配
  → 付款审批
  → payment applications
```

### 7.3 Expense-to-reimbursement

```text
费用申请、明细和票据
  → 审批事实
  → 一张或多张 reimbursement invoice
  → 对员工的 outbound payment
  → 发票核销
```

`reimbursement` 是当前 invoice 的第四种 direction。钱到达报销人要通过 reimbursement invoice；claim 自身的 `applied_amount` 不再表达付款进度。一个 claim 可以分批开多张 reimbursement invoice，但同一 expense item 只能被开票一次。租户也可在 workflow definition 中选择直接核销旧式路径；客户端必须读取当前定义，不能硬编码一种流程。

### 7.4 Payroll-to-payout

```text
有效期内的个人 pay histories
  + 有效政策/外部标准
  + Agent 明示计算过程
  → payroll invoice（工资条）
  → 每人一笔 outbound payment
  → payment application
```

工资是特殊保密域：本人始终能看自己的工资；`payroll.read` 才能看他人；不可见的单条记录返回 404。客户端不能通过全局搜索、标题、缓存、通知和诊断侧漏存在性或金额。

### 7.5 Custom record-to-workflow

```text
object type definition
  → business object + source text
  → typed business object links
  → workflow definition
  → approval records + todos
  → lifecycle outcome
```

通用 `oryh-business-object` 覆盖任何 custom type。只有租户过程超出 definitions 能表达的范围时才需要专属 Skill；“新增一种对象”本身不是发布客户端或后端代码的理由。

## 8. 产品 Skills 全量分组

当前 33 个产品 Skills 按职责分为：

| 组 | Skills |
|---|---|
| 连接与个人工作 | `oryh-connect`、`oryh-skill-sync`、`oryh-my-work` |
| 员工自助 | `oryh-timesheet-submit`、`oryh-expense-submit`、`oryh-leave-submit`、`oryh-purchase-submit`、`oryh-quotation-submit`、`oryh-order-submit`、`oryh-resource-booking`、`oryh-payslip` |
| 人类审批 | `oryh-approve` |
| 通用对象与汇总 | `oryh-business-object`、`oryh-business-object-summary` |
| 销售、采购、财务和工资岗位 | `oryh-purchase-order`、`oryh-receivables`、`oryh-payables`、`oryh-billing-account`、`oryh-payroll` |
| 规则与管理 | `oryh-policy`、`oryh-master-data`、`oryh-access-admin`、`oryh-skill-author`、`oryh-data-migration` |
| 流程推进 | `oryh-timesheet-approval-flow`、`oryh-expense-approval-flow`、`oryh-leave-approval-flow`、`oryh-purchase-approval-flow`、`oryh-quotation-approval-flow`、`oryh-order-approval-flow`、`oryh-invoice-approval-flow`、`oryh-payment-approval-flow`、`approval-notifier` |

6 个演示租户 Skills 是 `jc-quote`、`jc-warranty-card-apply`、`jc-warranty-card-approve`、`jc-warranty-card-flow`、`jc-warranty-repair-record` 和 `sb-quote`。它们证明三点：租户过程是数据；角色决定 Skill 粒度；一个角色的完整业务弧线可以在一个 Skill 中按 references 渐进披露，而不是每个阶段或对象各建一个 Skill。

## 9. 客户端产品主张

ORYH AI Client 的差异化不是“内置一个能访问 ORYH 的聊天框”，而是：

1. 打开即是个人企业工作台，而不是空白 Prompt；
2. 已知查询和动作由确定性 Operation 直接执行，可刷新、固定和重跑；
3. Agent、页面和按钮共享同一 Operation，不重复生成 API 代码；
4. 把跨单据关系投影成业务线程，让用户看到一件业务从来源到结算的连续证据；
5. 把规则版本、计算口径、证据和正式决定放在同一工作表面；
6. 把企业、角色、Skill reach、风险和凭据生命周期做成专属安全体验；
7. 模型不可用时，个人工作、搜索、只读视图和已知操作仍能工作。

这款客户端同时是 ORYH 的首个兼容性参考实现：它应证明连接、权限变化、确认、撤销、多企业和端到端业务弧线，而不是让 ORYH 反向依赖本客户端。

## 10. 原生工作空间设计

产品整体是“个人企业工作台”，其中的业务模块称为工作空间。工作空间按当前 capability、Skill reach 和可见数据动态出现，不能只按角色名称硬编码。建议的顶层结构是：

| 工作空间 | 主要任务 | 默认阶段 |
|---|---|---|
| 我的工作 | open/overdue todos、本人在途、最近记录、Skill/连接异常 | MVP |
| 提交中心 | 工时、费用、请假、采购申请、报价、订单、资源预订 | MVP 起按能力扩展 |
| 决策中心 | 本人审批待办、证据包、审批时间线、部分成功恢复 | MVP |
| 业务线程 | 销售、采购、报销、工资、custom object 的关系与进度 | MVP 起按业务弧扩展 |
| 销售 | 报价、修订、订单、履约、开票和回款视图 | B1/B2 |
| 采购 | 申请、下单、收货、库存、进项票和付款视图 | B1/B2 |
| 财务 | 应收、应付、报销应付、付款、核销、billing accounts | B2 |
| 人事与规则 | 本人工资、薪资管理、政策、请假规则和计算证据 | B2/A |
| 自定义业务 | object type 目录、动态记录、links 和有界汇总 | B1 |
| 自动化与治理 | Skill reach、flow runs、规则版本、迁移任务和 Console 深链 | A |

用户只看到自己当前可用和有业务意义的工作空间。一个用户可以同时承担多个职责，不需要在客户端选择“切换角色”；同一页面中的动作仍由服务端逐次授权。

## 11. 业务线程与证据包

### 11.1 业务线程投影

业务线程投影由一组确定性查询和显式关系组成，至少包含：

- 当前根记录与关键金额/数量；
- 上游来源、下游履行和修订链；
- approval records、open/completed todos 和 workflow version；
- 附件与每个附件所属记录；
- append-only ledger 及 counter-entry；
- 服务端派生值及计算时间；
- 缺失、软删除或不可见关系的明确占位，不由 Agent 猜测补齐。

### 11.2 决策证据包

审批或高风险 proposal 必须固定本次决定看到的证据：

- todo 与目标记录；
- 当前明细、附件和关联主数据；
- 服务端派生指标；
- 当前 approval trail；
- policy/workflow/Skill 的实际版本；
- 读取时间和记录 `updated_at`；
- Agent 风险摘要与其引用来源。

用户确认后，客户端执行同一个冻结 proposal；不能让模型在确认后重新生成参数。如果关键事实或规则版本变化，原确认失效。

## 12. Operation 分类

Operation 不是 endpoint 的别名，而是有用户意义的有界查询或命令：

| 类别 | 示例 | 默认规则 |
|---|---|---|
| Query | 我的待办、项目列表、发票详情 | 可刷新和重跑，不调用模型 |
| Draft command | 创建/更新草稿、上传附件 | 可逆，明确本地或服务端草稿 |
| Lifecycle command | 提交、发送、关闭、恢复 | 读取当前状态和定义，R2 确认 |
| Human decision | 批准、驳回、退回 | 必须从本人 open todo 解析参数，R3 确认 |
| Ledger post | 核销、账户入账、库存移动 | append-only、幂等、R4 强确认，纠错用 counter-entry |
| Governance publish | 发布政策/工作流/Skill、修改角色 | 展示 diff、影响人数、gaining/losing 和 R4 控制 |
| Batch job | 主数据/历史单据迁移 | dry-run、分块、恢复、报告，不在普通聊天中后台静默运行 |
| Automation control | flow subscription 状态和 run 诊断 | 默认只读；不在员工客户端常驻执行 |

Human decision Operation 应以 `todo_id` 为入口，从当前用户自己的 open todo 派生 entity、round 和 sequence，不让模型自由填写这些关键字段。当前服务端仍是 approval fact 与 todo completion 两次写入，客户端必须恢复部分成功；长期建议服务端提供 todo-bound 的原子 decision command，并在服务端强制 assigned approver 与 no-self-approval。

## 13. 客户端、Agent、Console 和 Runner 的分工

| 工作 | 客户端确定性 UI | Agent | Console | Runner |
|---|---:|---:|---:|---:|
| 查看我的待办和业务线程 | 主 | 可解释 | 可全局浏览 | 否 |
| 从非结构化材料补齐草稿 | 预览/编辑 | 主 | 次 | 否 |
| 正式审批决定 | 确认/执行 | 检查与解释 | 可浏览 | 否 |
| 决定下一审批节点 | 展示 | 非常驻时仅诊断 | 配置规则 | 主 |
| 人员、角色、对象和 Skill 全局管理 | 起草/影响预览 | 辅助 | 主 | 否 |
| 批量迁移 | 专用任务 UI | 解释与映射 | 监控 | 否 |
| 自动化持续扫描 | 只读监控 | 否 | 配置/监控 | 主 |

## 14. 服务端能力现状与客户端依赖

### 14.1 已可直接作为设计基础

- `/auth/me` 提供当前 tenant、user、employee、role 和 permissions；
- 个人 device key 有 access expiry 和 refresh rotation；
- Skill distribution 已支持 capability 与 targeted audience 两轴，并提供 reach 原因；
- 主要列表支持过滤和可选分页，todo 可带有界 target summary；
- 业务详情已提供多类派生指标、关系和 approval records；
- 付款核销和 billing account 已有真实 PostgreSQL 并发守卫测试；
- Hosted Flow Agent 有固定 grant、subscription write scope 和 flow run ledger；
- React Console 已覆盖完整租户管理面。

### 14.2 真实企业客户端发布阻断或降级点

- 当前个人 Skill bundle 会把 access key 渲染进 Skill 文本；客户端只能在 Host 内存中严格解析并去除该字段，原始 bundle 不得进入模型/缓存/Renderer；eligible、无凭据、按 hash 获取的内容接口仍是应优先完成的 P1 平台契约；
- device approved secret 还需要短 TTL 清理和 PostgreSQL 原子单次消费证明；
- 普通用户缺少当前设备自助 revoke 和本人设备列表/管理 API；
- device start/poll、approve/deny 的限流、稳定机器错误、recent auth、统一 CSRF/no-store 仍需补齐；
- 多数 mutation 没有统一 Idempotency-Key + canonical body hash；客户端只能按 endpoint 白名单自动恢复；
- 多数记录没有统一 ETag/version；重要 proposal 只能用 `updated_at`、状态和重读进行保守失效；
- 高风险 step-up assurance 尚不存在，因此依赖该保证的 R4 动作不能开放；
- assigned approver 与 no-self-approval 主要仍由 Skill/角色配置保证，服务端需要更强的 todo-bound decision 约束才能成为硬安全声明；
- 稳定 error code、correlation id、能力版本发现和实体深链仍需形成公共契约。

### 14.3 不阻断首版

- MCP 不阻断首版；REST 是当前公共事实入口，未来 MCP 只能替换机械 transport；
- Hosted Flow Runner 的 worker 隔离演进不阻断员工客户端，只影响客户端是否把自动化标为满足某级托管保证；
- 通用报表、总账、外汇和跨企业聚合不属于客户端首版。

## 15. 首个可交付产品范围

首个可称为产品的版本不是“连接成功后出现聊天框”，而是以下闭环：

1. 连接一个测试企业并完成安全本地保存、刷新、验证和本地解锁；
2. 首页无模型展示个人 open/overdue todos、in-flight records 和最近业务线程；
3. 项目与待办等 Query 可修改筛选、固定和重复运行，模型调用数为零；
4. 完成工时和费用两个提交闭环，其中费用包含附件与来源确认；
5. 完成一个 todo-bound 审批闭环，能恢复 approval 成功/todo completion 失败；
6. 在同一记录上显示事实、派生值、Agent 判断、规则版本和审计深链；
7. 第二家企业连接后，Session、缓存、Skill 和 Operation 不能交叉；
8. 模型不可用时仍保留个人工作、只读视图和已有草稿；
9. 所有真实凭据对模型、Renderer、Session、日志和诊断不可见。

请假和资源预订可在同一阶段随后加入；销售、采购、财务和管理应按完整业务弧纵向扩展，而不是以 endpoint 数量横向铺开。

## 16. 设计评审检查表

每个新增功能必须回答：

1. 它属于哪条业务弧、哪个业务线程、哪个岗位任务和哪个 Operation 类别？
2. 哪些是 ORYH 事实、ORYH 派生值、Agent 判断和用户 proposal？
3. 需要引用哪个 policy、workflow、object type 和 Skill 版本？
4. 页面与 AI Tool 是否共享同一个 Operation？
5. 当前 capability 和 Skill audience 如何决定可见性，服务端最终如何拒绝？
6. 是否从显式关系构建，还是在猜测一条不存在的业务线程？
7. 未知结果、部分成功、并发变化和 counter-entry 如何恢复？
8. 这项工作更适合客户端、Console 还是 Runner？
9. 模型不可用时还有哪些确定性功能可用？
10. 是否保持 ORYH 对其他兼容 Agent 的开放性？

## 17. 审计索引

### 17.1 API 路由覆盖

本次通过当前 FastAPI 路由声明做静态清点，按模块得到：

| API 模块 | 路由数 | API 模块 | 路由数 |
|---|---:|---|---:|
| auth | 14 | billing | 38 |
| bundles | 7 | claims | 27 |
| console | 2 | device | 2 |
| flow runner bootstrap | 2 | flows | 6 |
| master data | 42 | notifications | 1 |
| objects | 32 | people | 18 |
| policies | 9 | purchasing | 34 |
| resources | 11 | roles | 7 |
| sales | 43 | skills | 9 |
| workflows | 3 | workspace | 19 |

合计 326。全 `app` 当前共有 396 个 FastAPI route decorator，另 70 个来自 `app/main.py`、平台 SaaS 与浏览器页面，不属于员工业务 Operation 目录。该表用于发现客户端能力遗漏；正式实现仍以固定 OpenAPI snapshot、运行时解析和逐 Operation 契约测试为准。

### 17.2 事实源文件覆盖

代码事实源包括 `app/api/`、持久模型、迁移与并发/领域测试，33 个产品 `SKILL.md`，以及 demo tenant 中的 6 个专有 Skill。产品与技术文档覆盖以下 22 份当前资料：

- 平台与能力：`ai-native-platform.md`、`capabilities-skills-api.md`、`scoped-skill-capabilities.md`、`skill-assignment-plan.md`、`mcp-adoption-plan-2026-08.md`；
- 身份、运行与界面：`device-flow.md`、`hosted-flow-agent.md`、`react-console.md`、`deployment.md`、`website-redesign-plan.md`；
- 业务域：`billing-accounts.md`、`receivables-payables.md`、`payroll.md`、`policies.md`、`leave.md`、`customers.md`、`demo-data.md`；
- 验证与历史：`e2e-agent-scenarios.md`、`e2e-agent-findings.md`、`agent-e2e-findings-2.md`、`production-e2e-test-plan.md`、`system-architecture-review-2026-08-16.md`。

历史 findings 和 architecture review 只用来定位风险与变更，不覆盖当前代码和测试。实现开始、升级 ORYH 或变更 Skill catalog 时必须重新生成这份覆盖快照。
