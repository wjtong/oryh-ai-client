# ADR-0006：采用能力派生工作空间、业务线程投影和分类 Operation

状态：接受
日期：2026-08-21

## 背景

ORYH 当前覆盖个人工作、员工自助、审批、销售、采购、库存、应收应付、报销、工资、往来账户、政策、租户定义对象和托管流程。把 `app/api` 的 326 个员工/租户 API endpoint、33 个产品 Skill 或服务端模型一比一映射成页面，会得到一个难以使用的缩小版 Console；只提供聊天框，又无法形成高频业务工具、重复查询和跨单据证据体验。

ORYH 的事实天然形成几条业务弧：报价到回款、请购到付款、报销到员工应付、薪资到发放，以及租户定义对象到审批结果。审批位置又由 approval records、open todos 和 workflow definition 共同决定，不能由单据状态或会话历史代替。

## 决定

1. 客户端以“我的工作”和按当前 capability、Skill reach 动态出现的业务工作空间组织产品，不按 endpoint、数据库模型、固定角色名或 Skill 一比一建导航。
2. 客户端为销售、采购、报销、工资和租户定义对象建立只读业务线程投影。投影只组合 ORYH 的显式外键、typed links 和详情结果，不创建新的服务端事实，也不让 Agent 猜测缺失关系。
3. 页面、按钮和 AI Tools 继续共享 Operation，但 Operation 按 Query、Draft command、Lifecycle command、Human decision、Ledger post、Governance publish、Batch job 和 Automation control 分类，各类拥有不同的确认、幂等、恢复和展示规则。
4. 正式审批 Operation 从当前用户自己的 open todo 派生 entity、round 和 sequence，不接受模型自由填写关键审批位置。当前两次服务端写入仍支持部分成功恢复；服务端原子 todo-bound decision 是后续增强。
5. 每个决策表面明确区分 ORYH 持久事实、ORYH 派生值、Agent 判断和未执行 proposal，并附实际使用的规则与 Skill 版本。
6. ORYH AI Client 是第一方优化和兼容性参考客户端，不成为 ORYH 的强制入口。ORYH 的记录、权限、Skills 和流程继续对其他经过验证的 Agent 开放。

## 后果

正面：

- 用户从“我要完成什么工作”出发，而不是学习 API 或模块清单；
- 同一件业务的来源、履行、审批、结算和审计可以连续查看；
- 工作空间随权限和 Skill audience 收窄，减少无关功能和模型工具；
- 不同风险动作具有可预测的确认和恢复规则；
- 新租户对象和租户 Skill 可以在现有工作空间框架内出现，无需一对象一发版；
- 保持 ORYH 的 headless 和 Agent 可替换属性。

代价：

- 客户端需要维护业务线程 projection、关系缺失状态和 Operation 分类元数据；
- 不能用一个万能 CRUD 页面或万能 HTTP Tool 快速覆盖全部 API；
- capability、Skill reach 和业务数据变化会导致动态导航，需要稳定空状态和解释；
- 跨域链条需要更多有界查询，必须控制 fan-out、分页和缓存陈旧语义；
- 当前服务端缺少统一 case graph、ETag 和原子审批 command，客户端需要保守组合并推动公共契约演进。

## 未选择的方案

### 每个 Skill 一个页面

拒绝。Skill 是角色过程合同，不是信息架构；同一 Skill 可能跨多个阶段和对象，多个 Skills 也可能共享一个工作空间。

### 每个 API 资源一个 CRUD 页面

拒绝。这会复制 Console，割裂业务线程，并把服务端存储结构暴露给普通用户。

### 只提供对话和动态卡片

拒绝。个人工作、重复查询、筛选、刷新和业务线程浏览不需要模型，纯对话会增加延迟、成本和不确定性。

### 在客户端创建统一 Case 实体

拒绝。ORYH 当前没有通用 Case 事实。客户端只能创建可重建的投影；真正需要跨域持久关系时，应通过 ORYH 显式外键或 `business_object_links` 建模。

### 把客户端作为唯一官方 Agent

拒绝。这会破坏 ORYH 的 Agent 独立性和 headless 定位，并让记录层重新绑定一个界面供应商。

## 重新评估条件

如果 ORYH 提供稳定的服务端 case graph/read model、原子 decision command 或 operation manifest，可以简化客户端 projection 和 Operation 元数据，但不会改变能力派生工作空间、事实分类和开放客户端定位。
