# ORYH AI Client 交付路线图

## 1. 路线图原则

- 先证明一个端到端安全闭环，再扩充业务域；
- 先把高频已知操作做成确定性入口，再用 Agent 处理模糊、判断和编排；
- 测试租户验证不等于可用于真实企业；
- 安全基础设施与业务功能同一阶段交付，不在末期补做；
- ORYH 后端依赖、DSH 扩展点和客户端工作分别跟踪；
- 每个阶段都有明确退出条件，未达成时不把后续功能当作完成；
- 财务、权限、批量和无人值守能力最后开放并单独评审。
- 以业务弧和可重建业务线程交付纵向切片，不以“接了多少 API/Skill”衡量完成度。

本文中的迭代表示约两周的规划单位，仅用于排序，不构成承诺日期。实际排期取决于团队规模、ORYH 后端改造和桌面签名基础设施。

## 2. 工作流划分

| 工作流 | 主要产物 |
|---|---|
| 产品与设计 | 用户研究、流程原型、术语、确认与错误设计 |
| DSH 集成 | `oryh-web` Profile、Bundle、Agent preset、Connection/Gateway/Remote、Session 与 Client plugin 扩展 |
| ORYH 连接 | OpenAPI 契约、auth、凭据、API transport、Skills |
| 业务能力 | 工具、卡片、Employee/Approver/Domain workflows |
| 桌面平台 | Renderer/Host 隔离、Keychain、安装、更新、系统集成 |
| 后端依赖 | canonical 无凭据 Skills、幂等、错误 code、设备与并发正确性 |
| 安全与质量 | 威胁模型、测试、脱敏、供应链、发布门禁 |

每个业务能力至少需要 Skill、工具、卡片、服务端契约、错误恢复、DSH Profile snapshot/Web evidence、E2E 和文档共同完成，不能只以“模型能调通 API”为完成。

## 3. 阶段 0：实施准备

目标：把规划转成可以开工的版本和契约基线。

### 3.1 工作项

- 评审并批准本目录的需求、架构、安全和 ADR；
- 确定首发平台顺序和桌面技术 spike 范围；
- 确定测试用 ORYH 环境、两个隔离租户和测试账号矩阵；
- 固定 DSH `dsh-v0.1.2-alpha.1`、commit `cd5ef81481`、Cordis 版本、`oryh-web` bundle 顺序与 Client plugin roster；
- 固定 ORYH OpenAPI snapshot 和最低服务端版本；
- 固定 ORYH 产品事实基线（当前为 `1ea1509`、`app/api` 326 个员工/租户路由、60 个映射模型、33 个产品 Skill + 6 个演示 Skill）；
- 评审[ORYH 产品模型与客户端蓝图](10-oryh-product-model-and-client-blueprint.md)，确认第一方参考客户端而非唯一入口的定位；
- 冻结 current `/my/skill-bundle` 的 Host-only adapter fixture、允许结构与 canary 扫描；同时确定 canonical 无凭据 Skill content endpoint 的负责人和 P1 里程碑；
- 定义产品术语表和中英文动作名称；
- 为秘密泄漏测试生成专用 canary 格式；
- 建立威胁模型评审人与发布责任人。

### 3.2 退出条件

- [ ] 关键 ADR 被接受或明确修订；
- [ ] 所有 MVP 阻断后端接口有负责人和验收契约；
- [ ] 技术验证只能使用测试数据的边界得到确认；
- [ ] DSH 与 ORYH 基线可复现；
- [ ] 首批用户旅程和原型测试计划确定。

## 4. 阶段 V：技术纵向验证

建议投入：1–2 个迭代。

目标：证明“连接—安全保存—绑定会话—读取—预览—确认—写入—审计关联”整条链路。

### 4.1 范围

1. ORYH 外部 `oryh-web` DSH Profile 与 Bundle；用 `dsh --profile oryh-web --dump-config` 证明层次与禁用项；
2. `oryh-business` preset 替换 `standard`/`ptc`，并移除 coding persona、Bash、文件编辑、终端和通用网络工具；
3. device flow、一个平台的 OS credential provider 与 credential bundle 原子替换；
4. 本地解锁/锁定、启动认证状态机、`/auth/me`、连接目录与 tenant-bound Session；
5. 一个无凭据内置测试 Skill，以及 current personal bundle 的严格 Host 内存 adapter fixture；
6. “我的工作”一级按钮、共享 Operation、待办视图与无模型刷新；
7. 由 capability + eligible Skill 生成的最小“我的工作/提交中心”工作空间；
8. 从一个 todo/记录沿显式关系构建的只读业务线程和四类真相标记；
9. 同一 Operation 的 AI Tool Consumer，证明 UI 与 Agent 不重复实现 API；
10. 一个低风险服务端草稿写 Operation；
11. 参数与 evidence digest 绑定的一次性确认卡；
12. Session/日志/Renderer 的 canary secret 扫描；
13. DSH recorded-session replay、Web browser snapshot 和一个真实测试租户 E2E。

### 4.2 明确排除

- 不使用真实企业或生产数据；
- 不承诺 Session 加密已达到生产要求；
- 不发布安装包给终端用户；
- 不实现全部 Skill 同步、附件、审批和刷新边缘情况；
- 不把技术验证版称为 MVP。

### 4.3 退出条件

- [ ] 模型、Session、Renderer、日志和诊断中找不到 canary token；
- [ ] A/B 租户会话不能交叉调用；
- [ ] 正常启动、OS 解锁取消、离线只读、refresh 失败和重新连接状态可重复验证；
- [ ] access/refresh 只作为一个 bundle 更新；Renderer、模型和 Session 均无法读取；
- [ ] DSH startup token/cookie、Host/Origin trust、Gateway Remote codec 与断线 replacement baseline 均通过负向和重连测试；
- [ ] 读工具展示规范卡片；
- [ ] 点击“我的工作”和刷新相同结果时模型调用数为零；
- [ ] UI 按钮与 AI Tool 产生相同 canonical Operation result；
- [ ] 写工具必须确认且确认后参数不可变；
- [ ] ORYH audit log 能与工具结果关联；
- [ ] DSH 无核心修改，或每个核心修改都有上游缺口记录；
- [ ] 技术 spike 得出桌面壳选择建议。

## 5. 阶段 F：产品基础

建议投入：2–3 个迭代，可与 ORYH 后端并行。

目标：建立所有后续业务域共同依赖的生产级基础。

### 5.1 客户端基础

- 多企业连接目录、惰性启动验证、刷新 single-flight、重连和服务端吊销后断开；
- OS user-presence、本地锁定、锁屏/睡眠恢复与敏感通知遮蔽；
- canonical 无凭据远程 Skill provider、manifest/hash/last-known-good，并删除 V 阶段 bundle adapter；
- OpenAPI 生成契约和错误分类；
- Operation registry、稳定 id/version、UI/Tool 双 Consumer 和统一 policy；
- Operation 执行类别、evidence packet、依据失效和部分成功规范；
- capability/eligible Skill 派生的 workspace registry；
- 只沿外键/typed links 的 business-thread projector 与逐来源陈旧状态；
- 最近结果、无模型刷新、已保存只读视图和 operation receipt；
- 加密 Session、投影和草稿 provider；
- 首页、会话列表、设置、连接状态与 Console 深链；
- 业务工具基类/约定、风险等级和统一确认策略；
- 中英文、本地化时间/金额和基础无障碍；
- 脱敏日志、诊断包和版本清单；
- 录制 Session replay、owner-local expected output 与 Web/ARIA snapshot harness。

### 5.2 ORYH 后端基础

- 按用户权限返回 canonical 无凭据 Skill 内容；
- mutation idempotency 与 request hash 的最小覆盖；
- 稳定机器错误 code 和 correlation id；
- 客户端支持的版本/能力发现；
- 必要的 Console 深链稳定约定；
- approved device secret TTL 与 PostgreSQL 原子单次交付；
- 当前设备自助吊销、本人设备列表/吊销、recent auth、device flow 限流和机器错误码；
- refresh grant 绝对/不活跃期限和账号安全事件失效。

### 5.3 退出条件

- [ ] 所有连接、Session、Skill 和缓存按租户分区；
- [ ] 日常打开无需重复 ORYH 登录；锁定、断开、删除本地数据和浏览器退出状态不混淆；
- [ ] 两个并发 poll 只有一个获得设备凭据，批准后未消费秘密按 TTL 销毁；
- [ ] 普通用户可吊销当前设备和自己的其他设备，不能操作他人或 service key；
- [ ] 两个目标桌面平台的 credential provider 通过基础测试，或 MVP 平台范围相应收窄；
- [ ] 本地敏感数据加密和删除有效；
- [ ] canonical 无凭据 Skill 接口契约和负向测试通过，V 阶段 bundle adapter 被移除；
- [ ] 无模型时仍可管理连接和查看客户端状态；
- [ ] 所有 P0 工具可采用统一 policy/card 机制。

## 6. 阶段 M1：员工自助 MVP

建议投入：2–3 个迭代。

目标：普通员工用客户端完成一条足够深的个人业务闭环，再复用同一基础扩展其他员工自助能力。

### 6.1 业务范围

- 一键打开我的开放/逾期待办和在途记录，不依赖模型；
- “我的工作/提交中心”按 capability 与 eligible Skill 生成并显示 reach 解释；
- 项目等常用业务视图、最近查看、固定视图和只读结果重跑；
- 工时创建、编辑、明细、提交和退回修正；
- 费用附件、字段抽取、查重、草稿和提交；
- 费用申请的业务线程与 evidence packet；
- 请假和资源预订作为复用验证项，在不削弱工时/费用闭环时纳入本阶段；
- 服务端事实卡、本地/服务端草稿卡、正式提交卡；
- 401/403/409/422/429/5xx 与未知写结果恢复。

### 6.2 设计研究

- 五分钟首次连接任务；
- 本地草稿与服务端草稿理解；
- 附件抽取来源标记；
- 多企业切换错误率；
- 正式提交确认的理解与误点率。

### 6.3 退出条件

- [ ] 产品需求中的 M1 场景 E2E 全部通过；
- [ ] 我的待办、项目列表、最近视图刷新和固定查询在模型关闭时仍能使用；
- [ ] “就此询问 AI”只发送用户选择的有界快照；
- [ ] 两租户、多角色、token 过期与离线恢复通过；
- [ ] 附件不进入 Session 二进制和诊断；
- [ ] mutation outcome unknown 能恢复，不提示盲目重试；
- [ ] 目标用户可在无工程人员帮助下完成核心任务；
- [ ] 安全门禁无 P0/P1 未接受问题。

## 7. 阶段 M2：审批人 MVP

建议投入：1–2 个迭代。

目标：审批人安全地处理一项正式业务决定。

### 7.1 范围

- 从本人 todo 进入审批；
- “决策中心”工作空间、todo target 首屏和处理前完整 evidence packet；
- 通用 approval timeline；
- 工时、费用、请假三类实体检查器；
- 附件和来源事实预览；
- 批准、驳回、退回专用确认；
- approval fact + complete own todo 的部分成功恢复；
- 并行、重复节点和多轮审批的只读展示；
- 对象 status、approval facts、开放 todos 和可能后续节点的分区展示；
- DSH 工具批准与 ORYH 正式审批的视觉、文案和事件分离。

### 7.2 退出条件

- [ ] 非本人 todo 无法通过 UI 或工具处理；
- [ ] 业务审批不能通过普通工具确认 UI 混淆完成；
- [ ] 参数变化、状态变化和过期确认均要求重新确认；
- [ ] approval 成功/todo 失败不会重复写 approval；
- [ ] 当前后端非原子审批限制被准确呈现，客户端不会把预检查称为服务端强保证；
- [ ] 三类实体的强制检查材料缺失时明确阻止或提示。

完成 M1、M2 和桌面发布基础后，才称为 ORYH AI Client MVP。

## 8. 阶段 D：桌面 MVP 与受控试点

建议投入：2–3 个迭代，部分可与 M1/M2 并行。

目标：把本地 Web 验证转成可控的 Windows/macOS 桌面产品。

### 8.1 范围

- Renderer sandbox、DSH Connection loopback trust 与桌面生命周期/IPC 安全边界；
- 单实例、协议唤起、系统浏览器 device flow；
- OS credential 与加密存储跨平台；
- 签名安装包、更新验签、灰度和回滚；
- 崩溃恢复、脱敏诊断和支持流程；
- 企业模型网关最小路径或明确的 BYOK 试点政策；
- 一小组自愿试点用户和非关键业务数据。

### 8.2 退出条件

- [ ] 两个平台安装、升级、回滚和卸载矩阵通过；
- [ ] Renderer 无秘密和任意 Host 能力；
- [ ] DSH Connection loopback 或受限 IPC 的安全测试通过；
- [ ] 试点隐私告知、数据保留和支持流程到位；
- [ ] 连续试点周期没有跨租户、重复写入或秘密泄漏事件；
- [ ] 用户任务成功率达到双方设定的 MVP 阈值。

## 9. 阶段 B1：销售、采购和通用对象

目标：覆盖非财务高频业务角色并证明租户自定义对象无需客户端发版。

### 9.1 范围

- `oryh-business-object` 与动态 JSON Schema 表单/卡片；
- business object links 和有界 summary；
- 从显式外键/typed links 重建“报价到收款”“采购到付款”和自定义对象线程；
- 报价创建、修订、折扣检查、提交/发送/关闭；
- 销售订单创建、提交和报价差异；
- 采购申请、未定价/SKU 待定和估算总额；
- 采购订单与收货相关操作；
- 单项主数据查询/创建；批量管理深链 Console；
- 对应审批检查器。

### 9.2 退出条件

- [ ] 新租户对象类型和 Skill 可动态出现，无需客户端版本变化；
- [ ] 对象定义/工作流更新导致旧确认失效；
- [ ] 报价漂移、采购未定价等派生检查由规范数据渲染；
- [ ] 业务线程不按标题、金额或日期猜测关系，缺失边明确可见；
- [ ] 工具目录通过渐进披露保持有界。

## 10. 阶段 B2：财务、人事敏感数据和企业能力

目标：在服务端正确性和客户端强确认都成熟后开放高风险业务。

### 10.1 前置条件

- ORYH 当前结算路径 PostgreSQL 行锁与真实并发测试保持通过；新增端点逐项通过同等级测试，并补齐 Decimal API 语义和幂等 request hash；
- 企业模型与数据处理政策明确；
- 高敏感 Session 零/短保留策略可用；
- R4 重新认证或双人控制策略确定。

### 10.2 范围

- `sales`、`purchase`、`payroll`、`reimbursement` 四类发票与适用匹配；
- 收款、付款、核销和未核销余额；
- 费用申请 → reimbursement 发票 → 出站付款 → applications 的可追溯线程，并兼容租户直接付款路径；
- billing account 与 append-only ledger；
- 工资处理和本人 payslip；
- 企业模型网关、策略下发、MDM 配置；
- 高风险审计关联和异常恢复。

### 10.3 退出条件

- [ ] 专项财务与 prompt injection 红队通过；
- [ ] 金额、币种、方向、账户和目标的强确认不可绕过；
- [ ] 并发、重复、部分成功和未知结果测试通过真实 PostgreSQL 环境；
- [ ] 敏感数据不进入标题、索引、遥测和诊断；
- [ ] 合规和业务负责人书面接受剩余风险。

## 11. 阶段 A：管理、迁移和自动化监控

目标：帮助租户管理员设计和治理系统，而不是把员工客户端变成无人值守 Runner。

### 11.1 范围

- 人员邀请、角色影响预览、禁用与 Console 协作；
- Policy 和 Skill 起草、diff、校验与明确发布；
- 对象类型和工作流辅助设计；
- 历史迁移专用任务 UI、dry-run、分块与恢复；
- Hosted Flow subscription/run 的只读监控与诊断；
- 受控的单次人工流程触发研究，不默认后台常驻。

### 11.2 退出条件

- [ ] Agent 不能自提权或发布未经确认的 Skill/Policy；
- [ ] 批量任务有范围、dry-run、进度、取消、恢复和报告；
- [ ] Flow Runner 的生产隔离问题不由桌面客户端绕过；
- [ ] 复杂配置仍有可靠 Console 退路。

## 12. ORYH 后端依赖计划

| 依赖 | 阻断阶段 | 建议负责人 | 验收证据 |
|---|---|---|---|
| canonical 无凭据 eligible Skill content | F | ORYH backend | capability + audience 过滤、hash/ETag、无 secret 负向测试；删除 V adapter |
| correlation/request id | V/F | ORYH backend | 工具结果与 audit 对齐 E2E |
| mutation idempotency + body hash | M1 起逐域 | ORYH backend | 同 key 同 body/异 body 测试 |
| 机器可读 error codes | F/M1 | ORYH backend | 客户端错误映射契约测试 |
| approved secret TTL + 原子单次交付 | F | ORYH backend | PostgreSQL 并发 poll、过期销毁和 no-store 测试 |
| 当前设备自助吊销 | F | ORYH backend | 幂等 revoke、普通用户 ownership 和断开 E2E |
| 本人设备列表与其他设备吊销 | F/M1 | ORYH backend/Console | 当前设备标记、最近使用、其他设备 recent auth、单设备吊销和越权负向测试 |
| Device recent auth、CSRF 与限流 | F | ORYH backend/Console | 旧会话、跨站、短码暴力和 poll slow-down 测试 |
| Refresh grant 生命周期 | F | ORYH backend | 绝对/不活跃过期、密码重置/禁用/撤销失效 E2E |
| R4 step-up assurance | B2 | ORYH backend/Identity | challenge、短期绑定、过期/跨租户/参数变化负向测试 |
| ETag/version concurrency | B1/B2 | ORYH backend | 并发更新 409 与重新确认 |
| 当前结算并发正确性 | 已有基线，B2 持续门禁 | ORYH backend | 现有 PostgreSQL 多连接测试持续通过；新增路径逐项补测 |
| 财务 request hash + Decimal API 语义 | B2 | ORYH backend | 同 key 异 body 409、金额舍入/序列化和未知结果测试 |
| 审批 todo 绑定/原子完成 | M2/企业正式发布 | ORYH backend | 非本人/自批负向测试、approval + todo 原子或可证明的等价语义 |
| 稳定实体深链 | M1/B1 | Console | 路由契约和回归测试 |

## 13. 团队与所有权建议

最小有效团队需要以下持续责任，不一定对应独立全职人数：

- 一名产品/业务负责人：流程范围、术语、成功指标和用户试点；
- 一名 UX/前端负责人：信息架构、卡片、无障碍和设计系统；
- 一至两名 DSH/TypeScript 工程师：Host、插件、工具、Session、UI；
- 一名桌面/平台工程师：Keychain、Electron/Tauri、签名更新和系统安全；
- 一名 ORYH 后端工程师：OpenAPI、Skills、幂等、错误和设备；
- 一名测试/安全负责人：自动化、威胁模型、红队和发布门禁。

如果人员较少，仍要保留这些“帽子”的独立评审；实现者不能单独批准自己的 R3/R4 安全设计。

## 14. 仓库与变更策略

- `main` 始终可构建并通过当前阶段门禁；
- 功能分支以一个可验收能力为单位，不按前后端文件类型拆开；
- OpenAPI snapshot、生成类型、工具、卡片和契约测试同一变更；
- Skill 变更带版本/hash、工具依赖和模型输出 snapshot；
- DSH 升级独立 PR，不与业务功能混合；
- 如需 DSH fork patch，记录上游 issue/PR、最小 diff 和删除条件；
- 每个非平凡设计决定新增或更新 ADR；
- 发布 tag 记录客户端、DSH、ORYH API、Skill catalog 和桌面壳版本。

## 15. 风险登记

| 风险 | 可能性/影响 | 缓解 | 触发处理 |
|---|---|---|---|
| DSH prerelease 频繁破坏接口 | 高/中 | 精确锁定、升级独立、公共 API 限制 | 评估 fork 或暂缓升级 |
| canonical 无凭据 Skill API 延迟 | 中/中 | V 使用严格 Host 内存 adapter（固定结构、零落盘、canary）并保留 LKG；F 删除 adapter | adapter 结构变化或任何泄漏即停用同步；canonical endpoint 延期只阻断 F 的平台收敛 |
| 桌面封装扩大工期 | 中/中 | 先 Web 纵向切片，早做 Electron/Tauri spike | 收窄首发平台 |
| 模型错误或不稳定 | 高/中 | 确定性工具/卡片、草稿、确认、mock replay | 降级到 Console/保留草稿 |
| 多租户上下文泄漏 | 低/极高 | tenant-bound Session、分区存储、双租户测试 | 发布阻断和安全事件 |
| 秘密进入 Session/日志 | 中/极高 | Keychain、传输注入、canary 扫描 | 发布阻断、轮换和清理 |
| mutation 重复写入 | 中/高 | 幂等、未知结果恢复、禁止盲重试 | 暂停相应写工具 |
| 工具目录随业务膨胀 | 高/中 | 按 Skill/权限渐进披露 | 拆分工具族和 Profile |
| 客户端复制 Console | 中/中 | 明确分工和深链 | 功能评审拒绝低价值复制 |
| ORYH 必需的端点级保证未完成 | 中/极高 | 按 capability 的阶段门禁，不把已修复问题泛化成全局阻断 | 不开放受影响的写 Operation |
| 业务线程误连记录 | 中/高 | 只用显式外键/typed links，逐边契约测试 | 禁用受影响投影，不允许模型补边 |
| Agent 结论冒充服务端事实 | 中/高 | 四类真相标记、evidence digest、依据版本 | 失效 proposal 并阻断提交 |

## 16. 实施启动清单

在开始写产品代码前完成：

- [ ] 用户确认本规划的产品边界和 MVP 范围；
- [ ] 选择阶段 V 的测试租户与第一个草稿实体；
- [ ] 确认 DSH `0.1.2-alpha.1`、`oryh-web` Profile/Client roster 和升级责任人；
- [ ] 确认 ORYH OpenAPI 基线；
- [ ] 确认第一个纵向业务弧、对应显式关系边和 evidence packet；
- [ ] 决定首个 OS credential provider 平台；
- [ ] 确认 current bundle adapter 的 fixture/secret-scan owner，以及 canonical 无凭据 Skill endpoint 的负责人；
- [ ] 选择桌面 spike 的默认方案；
- [ ] 确定测试、签名和更新基础设施的负责人；
- [ ] 为阶段 V 建立不可使用真实数据的环境控制。
