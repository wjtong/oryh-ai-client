# ORYH AI Client

ORYH AI Client 是面向 ORYH 用户的“个人企业工作台 + Agent”本地客户端。它以 DeepSeek Harness（DSH）作为 Agent 运行时，通过 ORYH 公共 API 读取和写入业务事实；高频已知操作直接运行，模糊意图、材料理解、规则判断和编排再交给 AI。它是第一方优化客户端和兼容性参考实现，不是使用 ORYH 的强制入口。

本仓库已开始实施。当前实现包括可测试的 Host 侧纵向基础、无秘密 Remote 契约、工作台状态层，以及一个可直接启动的本地 Web 工作台：ORYH device flow、短期 access key 自动刷新、连接/租户隔离、确定性快捷 Operation、结果复用和已保存操作。当前的内存凭据库只允许用于测试与开发，不是生产凭据存储。

## 当前可运行基础

`@oryh/ai-client-core` 已提供以下能力：

- 调用 ORYH `/api/v1/auth/device/start`、`/token`，浏览器确认后只对调用方返回无秘密的连接摘要；
- 通过 `/auth/me` 固化当前用户、员工与企业身份，所有后续调用按 `ConnectionId` 绑定；
- 用 `X-API-Key` 调用 ORYH API；收到明确的 access key 过期响应时，最多执行一次 `/auth/token/refresh` 并原请求重试；同一连接的并发刷新会合并，并在 access key 临近服务端到期时间时提前刷新；
- 已注册“我的待办”“我的费用申请”和“项目列表”三个确定性 Operation；同一次结果可本地复用，不会再次生成或调用 API；
- `@oryh/ai-client-workspace` 为界面提供“连接选择 → 直接运行 → 复用结果 → 保存操作 → 直接刷新”的状态机；多企业连接必须由用户明确选择，绝不静默切换；
- `OryhClientRemote` 是仅含浏览器安全数据的异步 BFF 契约。当前的 Host adapter 与未来 DSH Typert Remote 使用同一组方法，device code、access key 和 refresh token 都不在其中；
- `KeychainCredentialVault` 使用系统原生钥匙串保存短期 access key 与可刷新的 refresh token；`JsonConnectionStore` 只保存无秘密的连接 ID、服务端 origin 和身份摘要。Host 重启时仅恢复钥匙串条目仍存在的连接，且恢复连接必须先以 `/auth/me` 核对同一 stable user/tenant，才允许业务 Operation 执行；
- 禁止一个企业连接复用另一个连接的 Operation result；只有用户明确要求“询问 AI”时，才可将经过裁剪的结果投影为模型上下文。

`@oryh/ai-client-web` 把这些能力连接成一个本机回环工作台：

- 使用 Fluent UI 提供企业连接、设备短码授权、企业身份、我的待办、我的费用申请、项目列表、结果复用与已保存操作；可明确断开本地企业连接或发起另一个账号的设备授权；
- 浏览器只调用固定的同源 `/api/client/*` Remote 路由；路由只监听 `127.0.0.1`，拒绝跨源请求，并且不含任意 HTTP 代理能力；
- Host 使用 `KeychainCredentialVault` 与 `JsonConnectionStore`。access key 和 refresh token 留在系统钥匙串，连接元数据文件不保存凭据；
- 已保存操作使用单独的无秘密 JSON 记录，在重启后按原企业连接恢复；快捷入口与“直接刷新”走固定 Operation，不运行模型，也不会要求模型重新生成 API 调用代码。

## 启动本地工作台

先启动可访问的 ORYH 服务，例如本仓库开发环境对应的 standalone Compose：

```sh
cd /Users/wtong/git/calwbiz
docker compose -f docker-compose.standalone.yml up -d --build
```

然后构建并启动客户端：

```sh
cd /Users/wtong/git/oryh-ai-client
pnpm install
pnpm run build
pnpm run start:web
```

在浏览器打开 `http://127.0.0.1:4173`。首次使用输入 ORYH 根地址，开始设备授权，并在 ORYH 浏览器页面确认设备。要切换账号，可先在“打开 ORYH Console”中退出并登录目标账号，再点“连接其他账号”完成新的设备授权；“断开本地连接”会删除该账号在本机钥匙串中的凭据和该企业的已保存操作，但不会结束 ORYH Console 的浏览器登录。日常启动时，客户端会从系统钥匙串恢复连接，再以 `/auth/me` 核对当前凭据仍属于同一用户与企业；核对通过前不执行业务 Operation。开发时使用 `pnpm run dev:web`；可通过 `ORYH_CLIENT_PORT` 和 `ORYH_CLIENT_DATA_DIR` 指定本地端口和无秘密连接元数据目录。

在仓库根目录运行：

```sh
pnpm install
pnpm run verify
```

这些测试使用伪造的 HTTP Host，不会连接真实 ORYH，也不会需要任何密钥。

## DSH 开发组合

`@oryh/dsh-host` 是一个可安装的 DSH bundle。它只在 `developmentOnly: true` 下启动，并在 DSH Host 进程中提供 ORYH BFF controller；浏览器尚不能直接访问该 controller。

本机以当前 DSH 源码开发时，使用其内置 `web` profile 安装 bundle：

```sh
cd /Users/wtong/git/deepseek-harness
pnpm dsh plugin --profile web add /Users/wtong/git/oryh-ai-client/packages/dsh-host
pnpm dsh --profile web --dump-config
```

当前 DSH 源码已经能组合该 bundle 与 Web App、Gateway 和客户端插件 roster。暂时不要为源码版本创建自定义 `oryh-web` profile 并安装 `@deepseek-ai/dsh-web-app`：npm 上仍是较早的 RC 依赖闭包，安装会失败。待与本地源码一致的 DSH `0.1.2` 发布包可用后，再将同一 bundle 安装到专属 profile，并用 Typert 自动生成 `OryhClientRemote` 的 Host/浏览器产物。

当前 Web 工作台是独立的 loopback Host 验证形态，不是生产 DSH Profile。以下内容仍未完成，不能作为生产客户端发布：Typert 生成的 Remote、DSH 浏览器卡片/工作台插件、客户端本地锁定/用户 presence、会话与 Agent 对话，以及生产 Profile 的最小权限组合。

## 产品定位

ORYH AI Client 负责：

- 为“我的待办”“我的费用申请”、项目列表、最近结果和已保存视图提供无需调用模型的直接入口；
- 按当前 capability 和 Skill reach 显示提交、决策、销售、采购、财务、人事和自定义业务工作空间；
- 把一次已经确定的只读 API 操作保存为可刷新、可固定、可重复运行的业务视图；
- 把报价到回款、请购到付款、报销到员工应付等显式关系投影成连续业务线程；
- 把用户的自然语言请求转化为受约束、可预览、可审计的 ORYH API 操作；
- 为待办、单据、审批证据、规则版本、附件、账本和执行结果提供业务化交互，而不是暴露通用开发工具；
- 安全管理设备授权、短期访问令牌、模型凭据和多企业连接；
- 动态加载用户在当前企业有权使用的 ORYH Skills；
- 保留可恢复的会话和本地工作上下文。

ORYH 服务端仍然是业务记录、租户隔离、权限、生命周期、幂等和审计的唯一权威来源。现有 ORYH Console 继续负责完整的可视化管理；AI Client 不复制整个管理后台。

ORYH 的核心定位是 agent-native 企业事实与控制层。不同员工仍可使用不同的兼容 Agent，工作流也可跨多个 Agent 继续；本客户端提供更完整的个人工作、确定性操作、证据决策、多企业和本地安全体验，但不把 ORYH 重新绑定到一个专有界面。

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
| [ORYH 产品模型与客户端蓝图](docs/10-oryh-product-model-and-client-blueprint.md) | 服务端、API、Skills 和设计文档审计后的产品模型、业务弧与工作空间基线 |

架构决策记录：

- [ADR-0001：DSH 采用外部依赖与薄下游集成](docs/adr/0001-dsh-integration-strategy.md)
- [ADR-0002：凭据不得进入模型上下文](docs/adr/0002-credentials-outside-model-context.md)
- [ADR-0003：会话固定绑定一个租户](docs/adr/0003-tenant-bound-sessions.md)
- [ADR-0004：确定性业务操作优先于模型调用](docs/adr/0004-deterministic-operations-before-model.md)
- [ADR-0005：分离账号认证、设备授权、本地解锁和高风险 step-up](docs/adr/0005-separate-account-auth-device-grant-local-unlock-and-step-up.md)
- [ADR-0006：采用能力派生工作空间、业务线程投影和分类 Operation](docs/adr/0006-capability-derived-workspaces-and-business-thread-projections.md)
- [ADR-0007：采用 DSH 0.1.2 Web Profile 与类型化 Remote 集成](docs/adr/0007-dsh-web-profile-and-typed-remotes.md)

## 当前基线决定

1. 产品代码保留在本仓库，DSH 官方仓库仅作为依赖和源码参考；只有缺少扩展点时才维护最小 fork。
2. 第一阶段以本地 Web 形态完成纵向验证，生产目标是 Windows 与 macOS 桌面客户端。
3. 每个会话只属于一个 ORYH 租户；切换企业必须切换或创建会话。
4. ORYH access token、refresh token 和模型密钥不得出现在本客户端产出的或模型可见的 Skill Markdown、模型请求、会话日志或遥测中。
5. 生产 Profile 默认不提供 Bash、任意文件读写、LSP、通用 `curl` 或自修改能力。
6. 所有业务写操作通过窄类型工具完成；高影响操作必须展示业务预览并由用户明确确认。
7. DSH 系统级工具批准与 ORYH 业务审批是两套概念，界面和数据模型必须明确区分。
8. 当前 ORYH Console 保持管理面职责，客户端通过深链打开需要完整表格或配置界面的页面。
9. 已知意图和参数的操作直接执行确定性业务 Operation；模型只用于理解、判断、解释和编排。
10. 日常打开客户端不重复 ORYH 登录；账号认证、设备授权、本地解锁和高风险 step-up 是四个独立机制。
11. “锁定客户端”“断开企业”“删除本地数据”和“退出 ORYH 浏览器”不得合并为一个含义不清的“退出”。
12. 客户端按当前 capability 与 Skill reach 派生工作空间，不按 endpoint、模型或固定角色名复制 Console。
13. 跨单据业务线程只是由 ORYH 显式关系构建的可重建投影；缺失关系不由 Agent 猜测。
14. 客户端明确区分 ORYH 事实、ORYH 派生值、Agent 判断和未执行 proposal，并记录实际使用的规则版本。

## 规划依据

本规划基于以下本地源码基线：

- ORYH 服务端与 Console：`/Users/wtong/git/calwbiz`
- DeepSeek Harness：`/Users/wtong/git/deepseek-harness`

本次产品审计对应 ORYH commit `1ea1509`（2026-08-21）：`app/api` 中 326 个员工/租户 API 路由声明、60 个 SQLAlchemy 映射模型、33 个产品 Skills 和 6 个演示租户 Skills。数字用于覆盖审计，不作为未来兼容承诺；详细结论见[产品模型与客户端蓝图](docs/10-oryh-product-model-and-client-blueprint.md)。

本轮 Harness 架构基线对应 DSH `dsh-v0.1.2-alpha.1`（commit `cd5ef81481`，2026-08-28）。客户端将采用其 `dsh --profile` 启动约束、Web App、浏览器 Connection、Typert Gateway/Remote 和可组合 Client 插件面；采用细节见 [ADR-0007](docs/adr/0007-dsh-web-profile-and-typed-remotes.md)。

实现启动前应重新核对两个上游仓库的版本，并把采用的 ORYH OpenAPI 快照和 DSH 精确版本写入本仓库。
