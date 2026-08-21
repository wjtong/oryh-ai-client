# ORYH 能力与 Skills 映射

本文把 ORYH 当前产品 Skills 映射为客户端功能、工作空间、Operation、交互表面和交付阶段。它回答“整个客户端最终覆盖什么”，但不要求每个 Skill 对应一个独立页面或一个超大工具。

审计基线为 ORYH `1ea1509`（2026-08-21）：`app/api` 中 326 个员工/租户 API 路由声明、60 个 SQLAlchemy 映射模型、33 个产品 Skill，另有 6 个演示租户 Skill。数量用于检查覆盖面，不代表要向模型暴露 326 个工具；详细事实见[ORYH 产品模型与客户端蓝图](10-oryh-product-model-and-client-blueprint.md)。

## 1. 分层规则

客户端把一项业务能力拆为五层，并由一个可复用的 Operation 连接应用与 Agent：

| 层 | 责任 | 示例 |
|---|---|---|
| Skill | 判断、检查顺序、禁止事项、业务语义 | 审批前必须查看票据和派生总额 |
| 业务 Operation | 类型化参数、窄 API 操作、规范结果 | 查询我的待办、创建费用草稿 |
| 消费入口 | 页面/按钮/已保存视图或 AI Tool | “我的待办”按钮、Agent 调用同一 Operation |
| 业务卡片 | 预览、证据、确认、结果和深链 | 报销预览卡、审批确认卡 |
| ORYH 服务端 | 权限、租户、生命周期、幂等、审计和事实 | 拒绝无权写入或非法状态转换 |

Skill 不包含真实凭据。Operation 不自行决定工作流下一节点。客户端卡片不把模型推断显示成服务端事实。意图和参数明确时，按钮和视图直接运行 Operation；需要自然语言理解或业务判断时，AI Tool 才成为同一 Operation 的 Consumer。

Skill eligibility 是两个条件的交集：用户具备 Skill 所需 capability，并且 Skill 采用 capability 模式或当前用户在其目标 audience 中。Audience 只能缩小投放，不能授予 capability。`/my/skills/reach` 用于解释“为什么收到/为什么未收到”，其中的角色信息不得被客户端转换成提权建议。

每个 Operation 还必须属于一个执行类别：Query、Draft command、Lifecycle command、Human decision、Ledger post、Governance publish、Batch job 或 Automation control。类别决定确认、幂等、审计、部分成功和未知结果的恢复策略；它比简单的“读/写”二分更能表达 ORYH 业务风险。

## 2. 阶段定义

| 阶段 | 名称 | 目标 |
|---|---|---|
| V | 技术验证 | 证明连接、凭据、DSH 插件、会话绑定和一读一写 |
| M | MVP | 普通员工与审批人的高频闭环 |
| B1 | 业务扩展一 | 销售、采购、通用业务对象 |
| B2 | 业务扩展二 | 财务、账户、工资与高风险业务 |
| A | 管理与自动化 | 租户配置、Skill 创作、迁移和流程监控 |

## 3. 全局与个人工作

| ORYH Skill | 客户端能力 | 主要工具族 | UI | 阶段 |
|---|---|---|---|---|
| `oryh-connect` | 设备连接、重连、多企业 | connection service，不暴露 token 工具 | 连接向导、企业切换器 | V |
| `oryh-skill-sync` | manifest 比较、Skill 热更新 | skill provider | 同步状态、版本提示 | V/M |
| `oryh-my-work` | 待办、逾期、本人在途进度 | identity、todo、record query | 一级“我的工作”入口、待办卡、进度卡；刷新不调用模型 | V/M |
| `oryh-business-object-summary` | 按类型和范围汇总业务对象 | bounded query、summary input | 摘要卡、来源列表 | B1 |

`oryh-connect` 在专属客户端中主要由确定性代码实现，模型只解释连接状态和引导用户，不接触 device code 之外的秘密。`oryh-skill-sync` 由后台同步机制实现，模型不负责下载、解压或覆盖文件。

## 4. 员工自助

| ORYH Skill | 客户端能力 | 关键交互 | 阶段 |
|---|---|---|---|
| `oryh-timesheet-submit` | 创建、编辑、查询、提交本人工时 | 周期/项目/时长预览，提交确认 | M |
| `oryh-expense-submit` | 票据读取、费用草稿、附件、查重、提交与退回修正 | OCR 来源标记、金额合计、票据预览 | M |
| `oryh-leave-submit` | 创建、编辑、提交本人请假 | 日期、时区、时长和冲突提示 | M |
| `oryh-resource-booking` | 查询可用性并预订资源 | 时间范围、冲突与资源卡 | M |
| `oryh-payslip` | 查询本人可见工资单 | 高敏感只读卡、重新认证策略 | B2 |

员工自助工具必须使用当前 user credential 的服务端归属，不接受模型指定“代谁提交”。若用户要求代他人操作，客户端应解释权限边界或引导使用被授权的管理员流程。

## 5. 审批

| ORYH Skill | 客户端能力 | 关键交互 | 阶段 |
|---|---|---|---|
| `oryh-approve` | 对任意支持实体记录一次正式审批事实并完成本人 todo | 证据区、决定区、正式确认 | M |
| `approval-notifier` | 通知分配、退回、批准或拒绝结果 | 客户端只显示结果；发送通常由流程侧执行 | A/服务端 |

统一审批 Skill 不意味着统一审查内容。卡片根据实体类型加载专用检查器：

- 费用：附件、发票字段、重复风险、总额；
- 报价：目录价、派生折扣和例外说明；
- 销售订单：与已赢报价的差异；
- 采购申请：未定价行、SKU 待定、供应商信息；
- 发票：方向、订单匹配、已开票与收货差异；
- 付款：收款账户、金额、币种、可核销余额；
- 工时和请假：期间、明细、冲突和历史审批事实。

## 6. 通用业务对象与租户定义流程

| ORYH Skill | 客户端能力 | 主要工具族 | 阶段 |
|---|---|---|---|
| `oryh-business-object` | 按对象定义创建、更新、查询和关联任意 custom object | object definition、business object、links | B1 |
| `oryh-business-object-summary` | 对一个 custom type 做有界汇总 | object query | B1 |

客户端必须在每次重要写入前读取最新对象定义和工作流版本，动态生成字段预览。JSON Schema 决定字段合法性；自然语言工作流决定 Agent 在提交前需要检查什么。客户端不得缓存后假定定义永久不变。

## 7. 销售

| ORYH Skill | 客户端能力 | 关键交互 | 阶段 |
|---|---|---|---|
| `oryh-quotation-submit` | 创建、修订、提交、发送和关闭销售报价 | 客户/产品匹配、价格与折扣预览、版本差异 | B1 |
| `oryh-order-submit` | 创建和提交销售订单，比较已赢报价 | 报价漂移、数量、价格、客户与交付信息 | B1 |
| `oryh-quotation-approval-flow` | 推进报价审批路由 | 默认不由交互客户端执行，只监控与人工触发诊断 | A |
| `oryh-order-approval-flow` | 推进订单审批路由 | 默认不由交互客户端执行，只监控与人工触发诊断 | A |

## 8. 采购

| ORYH Skill | 客户端能力 | 关键交互 | 阶段 |
|---|---|---|---|
| `oryh-purchase-submit` | 创建、编辑和提交采购申请 | 供应商提示、产品/SKU、未定价与估算总额 | B1 |
| `oryh-purchase-order` | 将批准需求转成采购订单并记录执行信息 | 订单行、供应商、调整、收货事实 | B1 |
| `oryh-purchase-approval-flow` | 推进采购审批路由 | 交互客户端默认只读监控 | A |

## 9. 财务与账户

| ORYH Skill | 客户端能力 | 风险级别 | 阶段 |
|---|---|---|---|
| `oryh-receivables` | 销项发票、收款和核销 | 高 | B2 |
| `oryh-payables` | 进项发票、付款和核销 | 高 | B2 |
| `oryh-billing-account` | 储值、信用、积分和不可编辑流水 | 高 | B2 |
| `oryh-invoice-approval-flow` | 发票审批与账龄待办 | 高，默认服务端流程侧 | A |
| `oryh-payment-approval-flow` | 付款审批和状态推进 | 极高，默认服务端流程侧 | A |

ORYH 当前发票方向包含 `sales`、`purchase`、`payroll` 与 `reimbursement`。费用报销可按租户流程采用直接付款，或采用“费用申请 → 一个或多个 reimbursement 发票 → 出站付款 → payment applications”；客户端读取适用 workflow/Skill 后展示实际路径，不硬编码唯一方案。付款记录和核销是两个独立 Ledger post，必须分别确认和审计。

财务能力进入客户端前必须满足以下前置条件：

1. 当前 PostgreSQL 结算并发锁与真实并发测试继续作为发布基线；新增高风险端点仍需逐项证明并发正确性，并补齐 request-body 幂等摘要、统一 Decimal API 语义和未知结果恢复；
2. 客户端实现不可绕过的金额/币种/对象/收款方确认卡；
3. 未知结果的写调用不会自动重试；
4. 每次动作都能关联 ORYH audit log；
5. 安全测试证明 prompt injection 无法改变收款账户或目标对象。

## 10. 人事、政策与工资

| ORYH Skill | 客户端能力 | 阶段 |
|---|---|---|
| `oryh-leave-approval-flow` | 请假流程推进；交互客户端默认只读监控 | A |
| `oryh-payroll` | 工资记录与批次相关高权限操作 | B2 |
| `oryh-payslip` | 本人工资单只读查询 | B2 |
| `oryh-policy` | 查询、起草和发布租户政策 | A |

工资和政策数据属于高敏感信息。默认不进入会话标题、搜索索引、诊断和遥测；本地保留期限应比普通会话更短，并支持企业策略强制禁止持久化。

## 11. 管理能力

| ORYH Skill | 客户端能力 | 客户端与 Console 分工 | 阶段 |
|---|---|---|---|
| `oryh-master-data` | 查找、创建和修正主数据 | 对话适合单项；批量浏览和清理进入 Console | B1/A |
| `oryh-access-admin` | 邀请、角色选择、禁用用户 | Agent 解释影响并起草；权限矩阵和批量管理进入 Console | A |
| `oryh-skill-author` | 从自然语言起草和校验租户 Skill | 客户端编辑/预览；发布必须明确确认 | A |
| `oryh-policy` | 起草和发布政策 | 对话起草；历史与全局浏览进入 Console | A |
| `oryh-data-migration` | 历史数据 dry-run、分块导入和报告 | 专用任务界面，不在普通对话中静默运行 | A |

管理工具永远不能因为 Agent 自己建议而扩大当前用户权限。服务端 capability 仍是最终判断，客户端同时使用本地工具目录限制减少误调用。

产品 Skill 之外，当前演示租户还证明了租户专有流程可以在不发布客户端版本的情况下出现：`jc-quote`、`jc-warranty-card-apply`、`jc-warranty-card-approve`、`jc-warranty-card-flow`、`jc-warranty-repair-record` 和 `sb-quote`。这些 Skill 不是第一方硬编码模块；只要它们组合已有 Operation，客户端通过自定义业务工作空间、动态卡片和 Skill 内容承载。需要新 API 语义时才增加受审查的 Operation。

## 12. 流程推进 Skills

以下 Skills 面向 admin/flow agent，而不是普通桌面会话：

- `oryh-timesheet-approval-flow`
- `oryh-expense-approval-flow`
- `oryh-leave-approval-flow`
- `oryh-purchase-approval-flow`
- `oryh-quotation-approval-flow`
- `oryh-order-approval-flow`
- `oryh-invoice-approval-flow`
- `oryh-payment-approval-flow`
- `approval-notifier`

客户端首要职责是展示它们产生的状态、待办和 flow run，而不是在员工设备上持续无人值守地执行它们。后续管理员可以在受限诊断模式下人工触发单次运行，但这不能替代 Hosted Flow Runner 的隔离设计。

## 13. 能力派生工作空间与业务线程

客户端导航按当前 capability、eligible Skill 与租户功能动态生成，而不是按角色名切换一套固定菜单：

| 工作空间 | 典型内容 | 主要事实源 |
|---|---|---|
| 我的工作 | 开放 todo、逾期、本人在途、最近结果 | `/todos?include=target` 与本人可见记录 |
| 提交中心 | 工时、费用、请假、资源预订 | 员工自助 Skill 与对应 API |
| 决策中心 | 本人的审批待办、证据包、正式决定 | todo、实体详情、approval facts、附件 |
| 业务线程 | 上下游单据、关系、阻塞项和审计 | 显式外键、typed links、服务端派生值 |
| 销售 | 报价到订单、开票、收款与核销 | quotation、sales order、invoice、payment |
| 采购 | 采购申请、采购单、收货、进项发票与付款 | purchasing、inventory、invoice、payment |
| 财务 | 应收应付、账龄、账户流水、工资/报销发票 | billing、claims、payroll |
| 人员与规则 | 请假、工资单、Policy 与人员事实 | people、policies、payroll |
| 自定义业务 | 租户对象类型、对象、typed links 与流程 | objects、workflows |
| 自动化与治理 | flow runs、Skills/Policy 发布和诊断 | hosted flow、skills、audit/Console |

工作空间只改变信息组织，不改变授权。一个用户可以同时拥有多个工作空间；同名角色在不同租户也可以看到不同模块。每次 Operation 仍由 ORYH 服务端按当前 credential 判定。

“业务线程”是只读、可重建的投影，不是新的 `Case` 实体。客户端只沿服务端返回的外键和 typed links 关联记录，缺失链接显示为缺失，绝不让模型猜测。线程必须把四类信息分开：对象当前状态、已经写入的 approval facts、代表当前持有人的开放 todos、workflow 定义中可能的后续节点。

R2–R4 动作在业务线程上生成 evidence packet，记录原始详情/明细、附件引用、主数据、服务端派生指标、审批轨迹、开放待办以及适用 Policy、Workflow、对象定义和 Skill 版本。UI 分别标识存储事实、服务端派生值、Agent 结论与尚未执行的 proposal；依据变化会让旧 proposal 失效。

## 14. 首批工具目录

技术验证与 MVP 建议保持小目录。

### 14.1 始终可用的只读工具

- 当前身份和权限；
- 当前租户 Skill/对象目录摘要；
- 我的待办列表与单个待办；
- 单个业务记录详情和审批进度；
- Console 深链生成。

### 14.2 按 Skill 开放的写工具

- 工时草稿、明细和提交；
- 费用草稿、明细、附件和提交；
- 请假草稿和提交；
- 资源可用性和预订；
- 记录一个审批事实；
- 完成本人的审批 todo。

Operation 应使用业务动词和规范 JSON 结果，避免向模型暴露通用的 `http_request(method, path, body)`。通用 HTTP 工具会绕过客户端对权限、确认、幂等和结果渲染的统一控制。

一次只读 Operation 成功后可以产生可复用的调用描述：稳定 operation id、版本、结构化参数、租户绑定和结果投影。它支持页面刷新、结果卡重跑和固定视图，不包含模型生成代码。Mutation 结果不能按相同方式静默重跑，必须重新建立 proposal 和确认。

## 15. 变更管理

当 ORYH 新增 Skill 或 API 时，按下面问题决定客户端变化：

1. 是否只是新的租户 Skill 判断文本？如果是，服务端发布后动态同步，无需客户端发布。
2. 是否只组合已有窄工具？如果是，更新 Skill 和卡片映射即可。
3. 是否需要新的确定性 API 操作？新增或生成业务工具，并完成契约、安全和 UI 设计。
4. 是否是服务端流程 Agent 的职责？只增加监控或诊断，不默认放入交互 Profile。
5. 是否触及资金、权限、身份或批量写入？必须提升确认等级并完成专项安全评审。
