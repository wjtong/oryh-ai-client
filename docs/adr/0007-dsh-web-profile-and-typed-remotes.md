# ADR-0007：采用 DSH 0.1.2 Web Profile 与类型化 Remote 集成

状态：接受
日期：2026-08-28

## 背景

DSH 当前 `dsh-v0.1.2-alpha.1`（`cd5ef81481`）已经把浏览器产品面明确为 Profile 组装的 Web App：`dsh --profile` 是受支持的 Node 应用入口；`dsh-web-app` 提供浏览器启动、受限 loopback 服务与按 Session 的 Agent preset；`dsh-client-connection` 负责启动 token 换取 HttpOnly 签名 cookie、Host/Origin 信任边界和重连代际；Typert Gateway/Remote 提供类型化 Client-to-Host 调用和流；Client Modules、slots、renderer、locale 与 conversation 包构成可组合的浏览器插件图。

早期方案把这些能力泛称为“Web Client 扩展”与自定义本地 Broker，容易导致产品重复实现 DSH 已有的认证、RPC、重连与 UI 组装，也会错误继承默认 coding/`ptc` preset 的工作台语义。

## 决定

1. 固定 DSH `0.1.2-alpha.1` 和对应 commit；升级必须重新审查本 ADR 所列公共面与 Profile 配置，不依赖未导出的 `src` 文件。
2. 安装器创建 `oryh-web` Profile，按顺序叠加官方 `dsh-base`、`dsh-web-app` 与 `@oryh/dsh-bundle` patch layer。开发、测试和桌面 sidecar 都通过 `dsh --profile oryh-web` 启动；ORYH 不发布另一个 Node application bin，也不绕过 Profile Loader。
3. `@oryh/dsh-bundle` 禁用默认 coding 工具与通用 workspace 表面，并让每个 ORYH Session 采用受限的 `oryh-business` agent preset。该 preset 使用 ORYH persona 和窄业务 Tool catalog，不启用 `ptc`、Bash、任意文件、终端、通用网络或自修改能力。
   > **2026-09-12 修订（[ADR-0009](0009-chat-pane-is-a-generic-oryh-agent.md)）。** `skill` 与 `bash` 已进入允许列表：Chat 栏是一个通用 ORYH agent，ORYH 的业务逻辑以 skill 交付，而 skill 的步骤是"运行这个脚本"。其余收窄（`ptc`、终端、通用网络、自修改）不变，工具允许列表仍由 `business-chat.ts` 的 `tools.restrict({ allow })` 显式列举。
4. ORYH 浏览器包以 DSH 的 `dsh.client`/`./client` 公共插件机制加入。复用 `client-connection`、Client Modules、UI renderer、slots、locale、conversation/chat 和 primitives 的稳定职责；ORYH 自己拥有根布局、业务导航、工作空间、业务卡、确认和业务线程。DSH 的 local Workspace Controller 只管理 Harness Session/工作目录，不能被误当作 ORYH 的业务工作空间。
5. 浏览器到 Host 的业务调用采用 DSH Connection + Typert Gateway 上的 ORYH typed Remote controllers。`@oryh/dsh-api-remotes` 负责生成 Remote contribution 和事件选择；React 组件不能直连 ORYH REST、调用任意 `/api` endpoint 或使用手写 WebSocket/IPC 协议。Host 从已绑定的 Session 或受检查的 connection reference 解析租户，拒绝浏览器或模型指定的任意 tenant、origin、header 与 secret。
6. DSH Connection 的启动 token、签名 cookie、loopback Host/Origin 检查和 Gateway stream 仅保护本地 UI 通道，不替代 ORYH device grant、refresh、step-up 或业务授权。ORYH access/refresh 仍只由 Host 的 OS credential provider 与 API transport 使用。
7. 任何 ORYH Remote stream 都以完整 opening baseline 或可验证 cursor 建立恢复点；不能把转发事件当作可回放事实。模型可见 ORYH context 必须进入扩展后的 DSH Session event vocabulary，确定性 Operation 结果保持在应用投影，直到用户明确“就此询问 AI”。

## 后果

正面：

- 直接复用当前 DSH 的浏览器认证、严格 RPC codec、取消、流复用与连接恢复，而非重建一层未审计的本地传输；
- ORYH 保留业务 UI 和 Operation 语义，同时可使用 DSH 的 locale、slots、conversation 与工具呈现扩展点；
- 每个 Session 的 preset scope 天然契合单租户 Tool/Skill/context 收窄；
- Profile 是可审查、可 `--dump-config` 的发布物，默认 coding 能力不会因包升级悄然出现。

代价：

- ORYH 需要维护 Host/Client 双面的 Remote controller 和生成物，而不是把任意 Host 函数暴露给 React；
- 默认 Web roster 首帧等待全部 Client 插件激活，ORYH 插件必须保持边界清晰且构建产物齐全；
- 桌面壳必须负责受控地启动、监控和停止 `dsh --profile oryh-web`，而不是把 Harness 当作可嵌入的未受限 Node 库；
- DSH 仍是 prerelease，升级需独立验证 Profile、Remote、Session、browser trust 与 UI snapshot。

## 未选择的方案

### Fork 默认 Web App 并修改其源码

拒绝。默认 Web App 的 transport、Client Modules 与 UI roster 已有公开的 Profile 与插件扩展面；ORYH 业务差异应由 patch、preset、Remote 和 Client plugin 表达。

### 自建未经类型化的 loopback HTTP/WebSocket 或通用 IPC

拒绝。它会重复 DSH Connection/Gateway 已处理的浏览器认证、输入 codec、取消和重连。桌面壳如采用 IPC，也只能封装命名的启动/窗口生命周期能力，不能另建业务 RPC 面。

### 复用 `standard` 或 `ptc` coding preset

拒绝。它们的 shell、文件、workspace 与编码 persona 违背 ORYH 的最小业务能力面；ORYH 建立独立 preset。

### 把 DSH 本地 Workspace 当作 ORYH 业务导航

拒绝。前者是 Harness 的 Session/目录组织，后者来自 ORYH capability、Skill reach 和显式业务关系，数据源与授权含义均不同。

## 重新评估条件

- DSH 为 stable release 改变 Profile、Web App 或 Remote 的公开组合方式；
- ORYH 需要的 typed Remote 或 Client slot 无法以 out-of-tree package 表达；
- 桌面安全 spike 证明 DSH loopback transport 无法满足目标平台的受控窗口模型；
- 运行时升级或替换不再能保持 tenant-bound Session、无秘密 Renderer 和可重放模型上下文。
