# ORYH AI Client

ORYH 客户端通过 DeepSeek Harness 的外部 Host 插件、Client 插件和 `oryh-web` Profile 运行。启动、认证通信、聊天、Session、模型设置和插件生命周期由 Harness 提供；ORYH 插件提供企业连接、业务列表和费用表单。

## 当前能力与边界

- 左侧 Harness 菜单中的「ORYH 业务」打开传统业务工作台，无需先配置模型或创建 Session。
- 待办、费用申请、项目支持查询、已载入数据的多条件筛选、详情和固定查询入口。
- 费用支持本地加密草稿、人工校验确认、创建、提交、结果核对；正式写入没有注册为模型工具。
- 凭据仅保存在 Host 和系统钥匙串，浏览器通过生成的 Typert Remote 调用业务服务。恢复连接后先验证用户与企业，跨企业结果不可复用。
- 官方聊天界面已复用；已支持当前待办及关联单据的只读 AI 查询，Session 固定绑定企业和员工。Chat 已支持工时查询、填写表单及修改/提交/审批建议；Chat 可直接打开右侧工时表单并自动更新未保存字段，保存与正式操作仍由用户核对确认，未开放直接写入工具。

三栏由 ORYH 外部根布局插件实现：左侧业务菜单及原生会话／设置，中间根级业务 Slot，右侧官方 conversation/chat/composer。布局要求与插件规范兼容，业务页面不依赖当前 Session。详情见 [插件迁移](docs/14-dsh-plugin-migration.md)。独立 Web Server、`/api/client`、Vite 页面入口和自建聊天壳已退役。

## 本机开发启动

依赖当前机器的同级 Harness 源码，所有 DSH 导入均走公开包导出；`link:` 依赖仅用于本地开发，不是可发布到 npm 的依赖版本锁定。

从干净工作区开始的完整顺序如下。**第 2、3 步不能省**：外部 Remote 补丁尚未进入上游，而且生成器是从构建产物运行的，只改源码不重建等于没打补丁（`scripts/check-dsh-patch.mjs` 会直接拦住）。

```sh
# 1. Harness 依赖
pnpm -C ../deepseek-harness install

# 2. 应用外部 Remote 补丁（版本基线见 patches/deepseek-harness-external-remote.json）
git -C ../deepseek-harness apply "$PWD/patches/deepseek-harness-external-remote.patch"

# 3. 构建 Harness —— 必须在打补丁之后，产物才带上修复
pnpm -C ../deepseek-harness build

# 4. 本仓库
pnpm install
pnpm run verify
pnpm run profile:install
pnpm start
```

补丁与 Harness 版本是耦合的：升级 DSH 后 hunk 会移位（0.1.5-rc.1 → rc.2 时就从 `analyzer.ts:1850` 移到了 `:1936`），需要重新导出补丁并同步更新 `patches/deepseek-harness-external-remote.json` 里的版本与 commit。守卫会在版本与基线不符时给出警告，在**执行中的生成器产物**缺少修复时直接失败。

开发环境使用 Node.js 24 与项目声明的 pnpm 11.19.0。`verify` 构建 Host、生成严格 Remote 产物、构建 Client 插件并运行类型检查与测试；生成步骤会断言产物里同时存在普通 Remote 与流式 Remote 描述符，避免"生成成功但什么都没产出"被当成通过。

`start` 调用正式 `dsh --profile oryh-web --port 4173`。默认 Harness home 为 `~/Library/Application Support/ORYH AI Client/harness`，可用 `DSH_HOME` 覆盖。启动时由 Harness 自动用授权链接打开默认浏览器，直接显示三栏工作台。若换用其他浏览器或看到认证提示，需在目标浏览器重新打开当前 CLI 输出的完整授权链接；仅访问根地址不能完成首次认证。

当前 Profile 禁用开发用 `client-hmr`：上游根 Slot 热替换有空窗，可能使渲染器报错。更新代码时先保存草稿、停止服务，再执行 `pnpm build` 和 `pnpm start`；已打开的旧标签页需刷新。

业务连接通过 ORYH 设备授权完成。已有钥匙串凭据继续使用；无凭据时输入 ORYH 根地址并在 ORYH 授权页面确认。本地 Host 的数据目录可通过 Profile 中 `oryh-client-host` 的 `dataDirectory` 指定绝对路径；同一目录只能由一个 Host 管理。

## 插件组成

| 包 | 职责 |
|---|---|
| `@oryh/dsh-bundle` | 为 Profile 插入 Host 和 Client 两个插件 |
| `@oryh/dsh-host` | Cordis 服务、生成的 `oryh` Remote、单用户开发策略、卸载时请求中止 |
| `@oryh/dsh-client`（目录 `packages/web`） | 公开 Slots、Harness store/locale/theme、传统业务视图 |
| `@oryh/ai-client-core` | ORYH API、身份校验、系统凭据、确定性操作和加密草稿 |
| `@oryh/ai-client-workspace` | 不依赖 UI 框架的企业选择与工作台状态 |

Profile 目前明确要求 `developmentOnly: true`。本次验证包括真实 Harness 页面读取测试企业数据、真实 Cordis/Gateway 生命周期与严格参数测试。没有为验收向测试企业写入真实费用单。费用写流程的模拟测试和服务端限制见 [费用流程](docs/12-expense-workflow.md)。

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
- [ADR-0008：领域保持为库，不拆为可独立启停的业务插件](docs/adr/0008-domain-libraries-not-independent-plugins.md)

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

## 源码基线

ORYH：`/Users/wtong/git/calwbiz`。Harness：`/Users/wtong/git/deepseek-harness`，`0.1.5-rc.2` / `c291e7961a`，外加本次外部 Remote 符号识别兼容补丁。该补丁仍未进入上游发布，需在本机 DSH 工作区重新应用并重建后才生效；本仓库保留可审查副本，见 [迁移记录](docs/14-dsh-plugin-migration.md)。

模型与聊天配置见 [配置模型并开始聊天](docs/15-model-configuration.md)。左下角「模型与设置」复用原生 Models 页面，支持 Base URL、API key、协议和模型目录。

工时录入、修改、提交与经理审批的操作和边界见 [工时工作流](docs/16-timesheet-workflow.md)。

## 多租户服务器版实施（P0）

服务器版按 [实施方案](docs/19-multi-tenant-server-plan.md) 和 [S0 验收](docs/21-s0-acceptance.md) 推进，进度见 [P0 实施记录](docs/27-server-p0-implementation.md)。当前新增的是私有验证工具，**不是可部署的服务器版**；现有 Profile 的单用户限制仍保留。

`pnpm server:p0` 运行边界自动测试及显式 Docker 四身份探针；`pnpm server:p0:inventory` 记录实际生成接口；`pnpm server:p0:cold-build` 在临时目录验证已提交基线的干净克隆构建。使用方法与未验证范围见 [server-lab](packages/server-lab/README.md)。

## 本地 Docker Compose

完整单用户业务界面可通过仓库根目录的 `compose.yaml` 启动，默认连接测试环境。构建、首次认证入口和持久化说明见 [本地 Compose 指南](deploy/local/README.md)。这不代表多用户服务器版已完成。
