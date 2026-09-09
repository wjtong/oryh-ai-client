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
- 未向测试企业创建或提交真实费用单；模型端到端文本对话已于 2026-09-09 验证，详见模型配置文档。业务文案当前仅提供简体中文，并通过 Harness locale 字典访问。

独立预览的 Server、REST routes、Vite/main 入口、构建页面和模拟聊天均已删除；`pnpm start` 只启动正式 Harness Profile。

## 模型配置入口（2026-09-09）

通过公开 `settings.trigger` Slot 定制原生按钮文案为「模型与设置」，沿用 Harness Models 页的提供方、Base URL、协议、模型目录和 write-only API key 配置。工作区目录选择改为官方 browse Host/Client 插件组合，选择过程在页面内完成。操作步骤见 [配置模型并开始聊天](15-model-configuration.md)。

工时录入与经理审批已作为同一 Host/UI 插件的类型化 Remote 和业务 Slot 视图接入，详见 [工时工作流](16-timesheet-workflow.md)。确认不暴露给模型；审批事实与单据流程推进保持服务端规定的分工。

## 当前待办与 Chat（2026-09-09）

`@oryh/dsh-host` 通过公开 Tools 的 `defineTool/register/restrict/presentAs` 注册 `oryh_current_todo_details`，通过公开 SystemPrompt 的 section/context 提供产品指令和当前页面上下文；原生 Session/composer/model 调用链不变。前端使用公开 `useSessions` 选择源，借助生成的 `chatSelect/chatClear/todoDetail` Remote 同步上下文。没有读取 Harness 私有对象、工作区文件或绕过 Gateway。

模型只读工具不接收 connection、员工、单据编号或 URL；这些由浏览器选择与 Host 验证绑定。传统详情与模型复用 `TodoDetailService`，后者先验证待办分配给当前员工，再沿已知实体类型读取关联单据。采购申请、采购订单、销售报价、销售订单、工时和费用已接入；未支持类型明确报错。投影仅保留已知业务字段，不传递附件下载信息、自定义字段、metadata 或凭证。单据文本按不可信数据处理。

会话的企业/用户/员工范围以仅含非秘密身份标识的私有文件持久化，文件名是 Session ID 的摘要。相同会话不能改绑其他身份；有继承历史的分支不能绑定。当前待办是易失的页面选择，刷新后必须重新打开；运行中拒绝切换绑定并清除旧目标，清除后不发布旧的在途结果。文件与确认工具仍不可调用。

浏览器实际验证：在测试环境打开“审批 赵斌 报价 QT-000003：泰安市中心医院 JC-900 高速机采购报价”，原生 DeepSeek 会话成功调用 `oryh_current_todo_details`，获得销售报价类型、客户、3 台产品、单价 188000、服务端计算合计 564000 和审批记录。整个验证只读，没有提交或审批业务记录。跨租户/员工重绑、分支、运行中切换、清除后迟到结果、未知类型及字段投影有回归测试。

## 业务中栏布局修正（2026-09-09）

业务 Slot 内统一使用置顶页头，详情的返回按钮先于 Chat 状态和单据内容；列表仅显示一次标题，常用关键词/状态筛选保持展开，日期和排序收进可展开区域。关联单据采用字段网格，系统编号单独折叠。滚动定位使用真正的 `.oryh-business-seat`，打开详情回到顶部，返回恢复列表位置。工时列表、录入和审批详情分开显示，未保存保护与原有确认流程保留；费用编辑页头同样置顶。

验证：客户端构建、类型检查和 6 项客户端测试通过；1470×780 桌面及 524×713 应用内浏览器中列表首行在首屏，滚动详情时返回保持可见，筛选和返回正常。只读查看工时审批详情，验证新建工时表单及放弃未保存修改，没有提交业务数据。改动仍限于外部插件自有业务视图与样式，没有修改 Harness 原生会话或增加应用框架。

工时菜单已接入原生 Session 的查询和填写/操作建议工具，采用结构化参数、页面版本校验与现有业务确认流程，详见 [工时 Chat 协作](16-timesheet-workflow.md)。原来的空工具集和仅待办只读阶段描述为迁移历史，不代表当前能力。

## Chat 主工作区

三栏顺序更新为左菜单、中间官方 conversation、右侧 oryh.business；根 Slot 与 Session 作用域契约未变。导航通过 root store 的公开 owner 回调传入业务 Slot，不操作 Harness 私有 DOM 或状态。工时使用短时导航命令与浏览器状态回传，让对话打开表单并直接更新未保存字段，正式业务确认仍保留。以上取代早期“业务页面为主”和“点击应用填写建议”的交互，详情见工时工作流文档。

### 已有工时的 Chat 导航

新增外部 Host 工具 `oryh_find_timesheets`，并扩展 `oryh_open_timesheet` 的指定单据导航。沿用公开 Tools、Session、Slot/store 与生成 Remote；Host 核验本人/审批范围，浏览器加载成功后才回执。详情编辑能力来自实际权限与企业状态机。实现与验证见 [工时交互](16-timesheet-workflow.md#chat-打开已有工时2026-09-09)。

### 待办列表中的 Chat 序号导航

Client 将当前页经过筛选、排序和分页后的可见待办及版本同步到原有 Session 绑定。外部 Host 工具 `oryh_visible_todos` 返回该顺序，`oryh_open_todo` 按序号和版本验证目标归属，并通过既有认证 Remote 导航。传统点击和 Chat 使用同一详情读取操作与显示组件；详情回执复用同一读取结果，避免并发身份验证造成重复读取失败。模型运行中允许同企业的只读列表上下文更新，旧列表版本不能继续用于打开操作。

验证：构建通过，104 项测试通过。真实 Chat 在未手动选中时打开第一条 QT-000003 待办；将列表筛选为“何丽萍”后，同样的第一条请求打开该工时审批待办。没有审批或修改业务数据。

### 全页面实时上下文

工作台根层通过 `chatPageSync` 同步所有菜单的页面编号、递增版本，以及已有页面回调提供的当前列表/详情标题与筛选摘要。同步在页面布局提交时发出，不依赖某个业务子页面仍保持挂载；异常会重试。Host 保存独立的当前页面状态，切换后清除不匹配的待办/工时绑定、建议和旧导航，旧子页面的异步绑定不能恢复此前页面。同一视图的过期版本被拒绝，子页面清理不会清掉根层当前页面。

`oryh_current_page` 提供当前页面和已接入能力，原生 Session 上下文也以此覆盖历史页面。项目新建仍未接入，返回明确的能力限制，不把“添加项目”转成工时行项目修改。项目、费用、设置等页面均参与同步；此变更继续使用外部插件、公开 Session 与生成 Remote。

验证：构建及 107 项测试通过。真实客户端按“工时 → 项目 → 添加项目”复现，Chat 正确识别项目列表并说明新建能力未接入；切回工时后可正常重新关联。未修改或提交业务数据。

### 项目新建接入

项目新建已接入外部插件，取代上面的“尚未接入”阶段说明。原生 Chat 与传统列表入口共用项目表单，支持打开、读取和填写；权限复核、核对及正式创建仍由业务操作与用户确认负责。详见 [项目新建插件](17-project-workflow.md)。
