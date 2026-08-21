# ORYH AI Client

ORYH AI Client 是面向 ORYH 用户的“业务应用 + Agent”本地工作客户端。它以 DeepSeek Harness（DSH）作为 Agent 运行时，通过 ORYH 公共 API 读取和写入业务事实；高频已知操作直接运行，模糊意图、材料理解、判断和编排再交给 AI。

本仓库当前处于需求与架构规划阶段，尚未开始产品代码实现。

## 产品定位

ORYH AI Client 负责：

- 为“我的待办”、项目列表、最近结果和已保存视图提供无需调用模型的直接入口；
- 把一次已经确定的只读 API 操作保存为可刷新、可固定、可重复运行的业务视图；
- 把用户的自然语言请求转化为受约束、可预览、可审计的 ORYH API 操作；
- 为待办、单据、审批、附件和执行结果提供业务化交互，而不是暴露通用开发工具；
- 安全管理设备授权、短期访问令牌、模型凭据和多企业连接；
- 动态加载用户在当前企业有权使用的 ORYH Skills；
- 保留可恢复的会话和本地工作上下文。

ORYH 服务端仍然是业务记录、租户隔离、权限、生命周期、幂等和审计的唯一权威来源。现有 ORYH Console 继续负责完整的可视化管理；AI Client 不复制整个管理后台。

## 文档导航

| 文档 | 内容 |
|---|---|
| [产品需求](docs/01-product-requirements.md) | 用户、场景、范围、功能和非功能需求、成功指标 |
| [能力与 Skills 映射](docs/02-capability-map.md) | ORYH 现有能力如何进入客户端，以及各阶段范围 |
| [体验与交互设计](docs/03-experience-design.md) | 信息架构、关键流程、业务卡片、确认与错误恢复 |
| [技术架构](docs/04-technical-architecture.md) | DSH 组装、插件边界、数据流、存储和部署 |
| [安全与隐私](docs/05-security-and-privacy.md) | 威胁模型、凭据、租户隔离、日志和发布安全 |
| [交付路线图](docs/06-delivery-roadmap.md) | 分阶段计划、依赖、风险和完成标准 |
| [测试与验收](docs/07-test-and-acceptance.md) | 测试层次、安全测试、质量门禁和 MVP 验收 |
| [决策与待定问题](docs/08-decisions-and-open-questions.md) | 已确定的架构决策、待验证假设和产品选择 |
| [登录、认证与设备会话](docs/09-authentication-and-login.md) | 首次连接、日常启动、本地解锁、刷新、撤销和高风险重新认证 |

架构决策记录：

- [ADR-0001：DSH 采用外部依赖与薄下游集成](docs/adr/0001-dsh-integration-strategy.md)
- [ADR-0002：凭据不得进入模型上下文](docs/adr/0002-credentials-outside-model-context.md)
- [ADR-0003：会话固定绑定一个租户](docs/adr/0003-tenant-bound-sessions.md)
- [ADR-0004：确定性业务操作优先于模型调用](docs/adr/0004-deterministic-operations-before-model.md)
- [ADR-0005：分离账号认证、设备授权、本地解锁和高风险 step-up](docs/adr/0005-separate-account-auth-device-grant-local-unlock-and-step-up.md)

## 当前基线决定

1. 产品代码保留在本仓库，DSH 官方仓库仅作为依赖和源码参考；只有缺少扩展点时才维护最小 fork。
2. 第一阶段以本地 Web 形态完成纵向验证，生产目标是 Windows 与 macOS 桌面客户端。
3. 每个会话只属于一个 ORYH 租户；切换企业必须切换或创建会话。
4. ORYH access token、refresh token 和模型密钥不得出现在 Skill Markdown、模型请求、会话日志或遥测中。
5. 生产 Profile 默认不提供 Bash、任意文件读写、LSP、通用 `curl` 或自修改能力。
6. 所有业务写操作通过窄类型工具完成；高影响操作必须展示业务预览并由用户明确确认。
7. DSH 系统级工具批准与 ORYH 业务审批是两套概念，界面和数据模型必须明确区分。
8. 当前 ORYH Console 保持管理面职责，客户端通过深链打开需要完整表格或配置界面的页面。
9. 已知意图和参数的操作直接执行确定性业务 Operation；模型只用于理解、判断、解释和编排。
10. 日常打开客户端不重复 ORYH 登录；账号认证、设备授权、本地解锁和高风险 step-up 是四个独立机制。
11. “锁定客户端”“断开企业”“删除本地数据”和“退出 ORYH 浏览器”不得合并为一个含义不清的“退出”。

## 规划依据

本规划基于以下本地源码基线：

- ORYH 服务端与 Console：`/Users/wtong/git/calwbiz`
- DeepSeek Harness：`/Users/wtong/git/deepseek-harness`

实现启动前应重新核对两个上游仓库的版本，并把采用的 ORYH OpenAPI 快照和 DSH 精确版本写入本仓库。
