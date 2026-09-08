# DSH 插件迁移

本次将已有传统业务功能迁入正式 DSH Profile。用户要求发生冲突时优先满足 Harness 的插件要求；聊天协作业务能力仍是后续工作，不能标记为已完成。

## 实际组合

`oryh-web` 按顺序加载 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@oryh/dsh-bundle`。Bundle 插入 `@oryh/dsh-host` 和 `@oryh/dsh-client`。安装走 `dsh plugin --profile oryh-web add`，启动走 `dsh --profile`，没有独立 Node Web Server 或自建应用树。

Host 提供 `oryhClient`、`oryhExpenses`、`oryhAbort`，并挂载继承 `TypertRemoteService` 的 `OryhRemote`。公开请求类型经 `./types` 导出；`./typert` 与 `./remote` 由上游 `WorkspaceTypertGenerator` 生成。浏览器用 `ctx.remote.$mount()` 挂载生成产物，等待 `remote.oryh` 注入，再通过 Gateway 的 `RemoteResult` 调用业务。没有通用 URL 代理。

Client 通过 `./client` 与 `dsh.client` 声明参与 Harness 的浏览器模块加载。Bundle 禁用默认 `ui-layout`，由 `@oryh/dsh-client` 成为唯一 `root` 与 `ctx.layout` 提供者。根布局声明并渲染官方 `sidebar`、`conversation`、`rightbar`、`shell.overlay`，另外声明 `oryh.business`。

## 三栏与 Slot 作用域

左侧上半部是业务菜单，下半部渲染官方侧栏，保留工作区、会话与设置入口。中间 `oryh.business` 为 `root` 作用域，挂载列表、详情和费用表单。右侧直接渲染官方 `conversation`，维持 `session-maybe` 合约，兼容无会话状态。原生附件／结果面板仍通过严格 Session 作用域的 `rightbar` 渲染，作为覆盖面板打开；不占用业务 Slot。

因此，固定「左菜单、中业务、右聊天」与 Harness 插件规范并不冲突。原文将默认 `rightbar` 的 Session 限制等同于布局限制，现已纠正。实现没有复制聊天、Composer 或 Session，也没有修改官方组件的内部 DOM/CSS。

根级 `defineStore` 管理菜单、折叠与视图切换，Session 切换不构成业务组件的 key。已访问的业务页面保留挂载，菜单及聊天显示切换保留内存表单。850px 以下用业务／聊天切换，1100px 以下默认图标菜单，可展开原生会话入口。刷新或插件卸载仍会清除未保存修改，已保存草稿保持本机加密存储。

样式仅作用于 ORYH 自有类及业务 scope；Fluent 浮层在业务根内挂载。布局通过公开 theme snapshot 投影主题，卸载时撤销监听、恢复原 DOM 值；Slots、布局服务、字典和样式按 Cordis 生命周期释放。

## 当前根布局更新限制

实测 `client-hmr` 在卸载旧根与注册新根之间触发 `renderSlot('root') before any 'root' registration`。这是当前上游根入口热替换的空窗，不是三栏的插件规范冲突。ORYH Profile 通过官方 Bundle patch 禁用开发用 `client-hmr`，更新采用保存草稿、停止服务、构建、重新启动和刷新页面。未修改上游渲染器，也不承诺根布局无缝热更新。

## 安全与生命周期

所有业务读取及写入仍通过同一 Host 服务验证 Connection、用户、员工和企业。浏览器不持有 access key/refresh token。费用确认包含草稿 revision 和限时 token，未注册为模型工具。原生审批 UI 不冒充 ORYH 业务审批。

当前尚未建立企业绑定 Session、可撤销字段变更协议与 AI 查询工具。Profile 对每个 Agent 注册空工具允许集，并通过 `tools/pre-execute` 拒绝工具执行；这些限制随插件卸载撤销。原生聊天只有在用户配置模型后才可使用，不能操作 ORYH 业务数据。

Host Remote 卸载时停止接收新调用、中止所属 HTTP 请求并等待已进入的调用结束，不删除钥匙串凭据。请求中止不能撤销已到达服务端的写入；费用流程仍按待核对状态恢复，避免盲目重试。

## 兼容性修复

本机 Harness 基线为 `0.1.3-alpha.2` / `c389f96bf3`。其 Typert 生成器原先只识别工作区或环境声明内的协议符号，外部插件导入公开协议包时无法生成 Remote。本次补充了从消费者解析公开模块并比较导出符号身份的逻辑，保留严格类型生成；并验证无关包的同名导出不被当成 Remote。

该修复保留在 Harness 工作区，同时保存到本仓库 `patches/deepseek-harness-external-remote.patch`。它尚未进入上游发布。本机 `link:` 依赖不是发布锁定，分发插件前须换成包含该修复的兼容 DSH 发布版本，重新验证依赖闭包。

## 验证与限制

- 真实 Profile 的 resolved config 含官方 Web 与两个 ORYH 插件，默认布局及开发 HMR 已禁用；浏览器实际通过生成的 Remote 读取测试企业待办。
- 真实 Cordis/Typert/Gateway 测试覆盖加载、错误参数拒绝、错误类型保留、服务卸载、策略撤销与在途请求中止；ID 的编译期品牌不参与 JSON 数据。
- 本仓库类型检查、构建及 57 项测试通过。独立 HTTP 预览的测试随旧入口删除，不能与旧版本测试数量直接比较。
- Harness Remote 生成回归测试独立运行。未执行 Harness 全仓测试，也未宣称所有平台/版本兼容。
- Chrome 验证三栏、真实费用表单、菜单及聊天折叠保留未保存输入；应用内浏览器验证 390px 视图切换、菜单展开和离开确认，未保存测试输入已清理。新增公开 SlotCore/Cordis 测试验证 root 唯一性、作用域、布局服务调用、卸载重挂和主题恢复。
- 未向测试企业创建或提交真实费用单，未验证模型端到端对话。业务文案当前仅提供简体中文，并通过 Harness locale 字典访问。

独立预览的 Server、REST routes、Vite/main 入口、构建页面和模拟聊天均已删除；`pnpm start` 只启动正式 Harness Profile。
