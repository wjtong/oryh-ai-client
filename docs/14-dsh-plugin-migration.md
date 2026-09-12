# DSH 插件迁移

重构评审建议见 [plugin-split 重构评审（2026-09-12）](18-plugin-split-review-2026-09-12.md)。该文档记录待处理建议与验收条件，不代表改动已实施。

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

### 双向页面背景（2026-09-10）

原生 Session 的动态 context 每次组装均读取 `currentPage`，同时包含根页面信息与匹配的业务快照。列表同步当前筛选、分页、可见行及选中详情；项目同步未保存字段，工时同步当前字段、明细编辑、审批意见和可见队列，费用草稿仅同步业务字段与状态。确认凭据及企业认证信息不进入页面背景。系统设置页不采集凭据表单。

新增 `oryh_navigate` 通过现有认证 Remote 打开业务菜单，并等待根页面回传相同导航编号。已有工时/项目填写工具继续等待各自的字段版本回执；导航成功不等同业务提交。模型回答期间允许与当前根页面相匹配的业务上下文同步，旧页面绑定仍拒绝。根导航轮询失败后重试。费用 Chat 写入、任意网页操作及多窗口独立上下文尚不在此实现范围内。

验证：完整构建、类型检查及测试通过；新增页面快照、导航回执、旧版本拒绝、字段清理、运行中人工切换测试，总计 120 项。用户浏览器存在未保存工时，因此保留当前服务与页面，本次未刷新生产中的本地会话进行真实模型验证。

后续实测（2026-09-10 15:23）：确认用户已清空旧工时内容后，退出空白表单并重启客户端服务。在“我的工时”页面发送“我的todo”，真实模型调用 `oryh_navigate`，右侧自动显示“我的待办”及 2 条记录，Chat 使用当前页面快照列出同样的记录。未执行保存或审批。此前 15:22 截图来自仍在运行的旧进程。

### 销售、库存与收发货查询菜单（2026-09-10）

外部业务 Slot 增加销售订单、库存余额（InventoryItem）、库存流水（InventoryItemDetail）和 Shipment 收发货四个入口。Host `RecordService` 仅允许四个固定 GET 端点，复用当前连接验证、凭据隔离及生成 Remote；每页 25 条，服务端分页与筛选。销售订单/Shipment 使用关键词，余额按仓库精确匹配，流水按库存项编号精确匹配。流水默认遵循服务端仅显示活动库存项的规则，指定库存项编号可查看历史。

记录信息展示来自列表响应的白名单字段；本次不包含订单行、Shipment 行的完整明细，也不包含创建、审批、库存调整或过账。数值保留零和负数，库存余额与变动列明确区分。任意 metadata/custom_fields 不直接进入页面或模型上下文。查询过程中如租户或账号改变，结果被拒绝。

四个页面均接入 `oryh_navigate` 和实时页面背景，包含当前筛选、分页、可见记录及选中记录。构建、类型检查及 126 项测试通过。测试环境实测销售订单 3 条、库存余额 4 条、库存流水 10 条、Shipment 0 条；真实 Chat 从收发货页面导航到库存余额，并读取与页面一致的数量。未写入业务数据。

### 项目列表动态列（2026-09-11）

新增公开 Tools 工具 `oryh_project_columns`，经原有导航 Remote 传递列配置，等待当前项目列表回传相同命令编号及列顺序。仅允许项目名称、编码、状态、客户、开始日期、结束日期、创建时间、更新时间，名称不可隐藏。工具不能传代码、任意字段或业务写入。页面切换、无效列、重复列均拒绝；视图修改不触发正式业务确认。

项目解码增加真实 `created_at`/`updated_at` 字段，缺失值显示破折号。传统“显示列”复选框与 Chat 共用工作台列状态，并可恢复默认列；切换菜单期间保留，整页刷新恢复默认（尚无个人持久化视图、列宽或拖拽配置）。列配置及时间字段随页面背景同步给模型。

构建和 128 项测试通过。真实 Chat 在 7 条项目的列表中追加创建时间，保留原来的名称、状态、客户和开始日期，页面显示服务端真实时间，模型收到页面回执。未修改项目数据。

### 库存、销售及收发货动态列（2026-09-11）

新增 `oryh_record_columns`，复用公开 Tools 与原有认证导航 Remote，为销售订单、库存余额、库存流水、Shipment 列表调整列和顺序。字段目录从 Core 公开的浏览器安全 `@oryh/ai-client-core/views` 导出，解码、模型校验及传统“显示列”共用目录。当前可见列、可选字段随页面背景同步；工具仅在列表模式运行，等待对应命令编号和列顺序回执，页面切换则拒绝。至少保留一列，未知字段、重复字段均拒绝。

库存流水的产品编码和仓库通过当前页去重后的库存项编号，在同一企业连接调用库存项 GET 获取；每批至多五个请求，关联缺失或不可访问显示破折号，完成后再次验证账号及租户范围。只提取明确白名单字段，不通过历史聊天推测关联数据。显示列配置在菜单切换间保留，刷新恢复默认，可手动恢复默认列。

完整构建、类型检查及 134 项测试通过。客户端重启后在真实 Session 发送“库存流水列表加上产品列，原来的列保留”，模型调用 `oryh_record_columns`，列表实际增加产品编码，首条显示 PT-HEAD，原有数量变动等列保留，模型收到匹配的页面回执。没有修改业务数据。

### 库存流水动态查询栏（2026-09-11）

公开 Tools 增加 `oryh_inventory_filters`，通过现有 ChatNavigation Remote 为库存流水显示或隐藏产品编码查询框，与“显示列”配置分开。仅增加字段不执行筛选；提供 productCode 时填写并使用 RecordPanel 同一查询操作。空值清空产品条件，移除字段同时移除该条件。库存项编号条件保留，与产品编码取交集；当前输入草稿、已应用条件、加载状态和结果同步到页面背景。工具等待查询栏回执，不能把“查询已发起”说成查询已完成。

ORYH 现有流水端点不支持 product_id：插件组合现有租户限定 GET，读取完整活动库存项分页，以产品编码精确匹配，收集匹配库存项的全部流水后统一按生效时间、创建时间、编号倒序分页。指定库存项编号时直接读取该项，可包含归档历史，保持原有语义。每次请求验证连接范围，汇总后再次验证；分页总量变化、重复记录、缺页或任一读取失败均不返回部分结果。组合查询限 100 次请求、单集合 10000 条，超限明确要求缩小范围。这是当前接口条件下的有界兼容实现；大规模查询应以后端原生产品筛选取代。无需更改或部署 ORYH 后端，无 Harness 私有路径或并行页面框架。

查询字段配置为当前页面状态，离开菜单或刷新后恢复默认；可从“查询字段”手动添加，清空条件保留查询框。

完整构建、类型检查及 140 项测试通过，覆盖工具回执、无效字段、只添加控件不查询、条件清空、跨库存项与跨页汇总、缺页/读取失败拒绝。真实 Session 调用 `oryh_inventory_filters` 加出空的产品查询框；手动查询 PT-RIBBON 返回两个库存项合计 3 条流水。

继续通过 Chat 将产品条件改为 PT-HEAD 并增加产品编码显示列，实际输入框更新为 PT-HEAD，列表显示其 3 条流水，模型收到完成后的页面背景。未执行业务写入。

### 产品放大镜与多选（2026-09-11）

产品条件升级为放大镜选择器，复用 Fluent Dialog 和认证 Remote：按产品名称/编码搜索，服务端每页 20 条，跨搜索/分页保留选择，最多 50 个。弹窗选择是临时草稿，确定后回填查询栏标签，取消不影响原条件；查询按钮才应用手动选择。可逐个移除或清空。搜索提交阻止事件冒泡，避免触发外层流水查询。

新增 productSearch Remote，仅输出产品 id/name/code，支持按已选编号解析标签，范围以当前企业连接为准。库存查询以 productIds 并集配合其他条件取交集，按每个产品服务端过滤库存项再完整收集流水，不依赖名称或当前页。旧单产品编码查询兼容保留。Chat 新增 `oryh_search_products` 搜索真实产品；`oryh_inventory_filters` 接受多选 productIds，Host 校验并取得真实产品标签后发送导航，等待相同选择编号回执；页面有更新则拒绝过期操作。多选条件和输入草稿均同步页面背景。

构建、类型检查通过，145 项测试通过，包括跨页勾选、取消、确认、多产品合并、Remote 字段白名单及企业范围变化。实测选择 PT-RIBBON 后搜索打印头并勾选 PT-HEAD，已有选择保留，回填两个标签并查询得到 6 条流水。

真实 Chat 分别搜索 PT-HEAD、PT-MOTOR，调用多选筛选工具回填两个标签并查询，列表显示 7 条流水，产品编码列同时更新；没有修改业务数据。

### 业务居中、Chat 右侧与紧凑布局（2026-09-11）

清除早期 Chat 居中样式覆盖，ORYH business Slot 位于中间，原生 conversation Slot 位于右侧。默认 56px 图标菜单，可展开为 208px；Chat 默认 360px，可加宽为 520px（中等宽度为 440px），也可隐藏，业务区接管剩余空间。窄屏继续切换业务/对话视图。布局通过原有公共 Slot、ILayout 和 Frame store 实现，折叠和隐藏均不卸载 Session 或业务组件。

客户端构建及 16 项前端测试通过。浏览器实测中间业务区从 1054px 扩展到隐藏 Chat 后的可用宽度；展开/折叠菜单、加宽/收窄 Chat 正常，隐藏后恢复仍保留未发送聊天草稿。布局偏好仍为当前根实例内状态，刷新使用紧凑默认值。

### Chat 连续调宽（2026-09-11）

取消两档宽度按钮，改为业务页面与 Chat 之间可拖拽的分隔线。Pointer capture 保持拖拽连续，放开或取消指针后结束；键盘左右箭头每次调整 20px，Home/End 到边界，双击恢复 360px。宽度通过原有公开 Frame store action 和 CSS 网格变量更新，不重建业务或 Session 组件。最小 280px，并根据窗口及菜单宽度为业务区保留至少 320px；隐藏恢复保留选择宽度，窄屏切换视图时不显示分隔线。刷新仍使用默认值。

客户端构建与 16 项前端测试通过。浏览器实际从 360px 拖到 516px，再通过键盘调整为 496px；隐藏后恢复仍为 496px。

### 列偏好持久化（2026-09-11）

替代之前刷新恢复默认列的行为：项目、销售订单、库存余额、库存流水和 Shipment 的显示列使用公开 `@deepseek-ai/dsh-client-store` 的 `createSnapshotStore` persistence 保存到当前浏览器。按服务地址、企业、用户及列表分别隔离，重连不依赖临时 Connection ID。Chat 和传统 UI 共用同一个更新入口，恢复默认列也会保存。

只存列标识及顺序，不存业务数据、查询值或凭证；恢复时校验字段白名单、去重，失效配置回退默认，项目名称列保留。当前实现为浏览器本地偏好，不跨设备同步。客户端构建及 20 项测试通过，包含组件卸载/重建、身份隔离、无效配置恢复和各业务列表重置。

真实 Harness 浏览器验证：Chat 调用 `oryh_record_columns` 给库存流水增加产品编码列，整页刷新后再次打开库存流水，产品编码及原有列按原顺序保留。

### 完整显示偏好（2026-09-11）

列持久化扩展为统一的显示偏好机制，继续使用公开 Harness Store。业务设置按服务地址、企业及用户隔离：查询栏字段、产品多选及已应用筛选、查询输入、列表筛选/日期/排序、分页、工时搜索、费用列表/草稿标签，以及筛选区、显示列区、规则和执行记录区的展开状态。列配置保持原存储键，已有配置不丢失。

全局浏览器布局保存当前菜单、菜单折叠、Chat 显示/隐藏、宽度和窄屏视图选择。窗口尺寸、用户身份、原生浮层及确认状态不持久化。偏好恢复经过类型/字段校验；列表重新走带租户鉴权的 Remote 查询，不缓存业务记录。恢复页码超过新的总页数时回到有效页。

查询值现在按用户要求一并保存（取代上一节仅保存列的范围）。业务表单及审批意见仍走原草稿和确认流程，恢复显示设置不会触发保存、提交或审批。偏好为当前浏览器本地存储，不跨设备同步。构建与 23 项前端测试通过，包括 Chat 产品筛选重建恢复、重新查询、清空条件、身份隔离及原生 Frame 生命周期。

浏览器验证：通过 Chat 增加库存流水产品查询字段，展开查询配置、展开菜单、将 Chat 调宽至 380px 并隐藏；整页刷新后仍停留库存流水，产品字段和查询区展开状态、菜单展开及 Chat 隐藏均恢复，再显示 Chat 时宽度仍为 380px。

### 升级到 DSH 0.1.5-rc.2（2026-09-12）

本机 Harness 基线从 `0.1.3-alpha.2` 升到 `0.1.5-rc.2` / `c291e7961a`，并按该版本源码重新构建（native-system、host/client lib、web frontend）。外部 Remote 符号识别补丁不在上游 0.1.5-rc.2 源码里，重新应用 `patches/deepseek-harness-external-remote.patch` 之后才重建，重建产物已确认包含该修复。DSH 工作区的这两处改动没有提交，下次同步 DSH 需要重新应用。

根布局随之迁移到 0.1.5 的 Slot 模型。顶层不再有 `conversation` 槽：对话是 `main`（keyed、root）里 key 为 `conversation` 的条目，三栏因此改为按 `entryKey` 渲染。`rightbar` 由 session 作用域改为 root，外层 `SessionProvider` 随之去掉。`ILayout` 增加 `selectPanel` 与 `beginNavigation`。ORYH 取代官方 ui-layout，所以 `panelInfo` 这个标准钩子必须由本插件通过 `provideRoot` 提供，否则原生侧栏读不到面板选择；布局服务、该钩子与根条目共用同一个 store 实例，面板插件卸载时由 `retainMainPanels` 把中栏退回对话。

`scripts/install-profile.mjs` 改用官方命令：profile 不存在时先 `dsh --profile oryh-web --from-default-profile web --dump-config` 从随发行版模板初始化（已含 base 与 web-app 两层，且不启动服务），再 `dsh plugin --profile oryh-web add`，不再手改 profile 的 `package.json`。

验证：`pnpm run verify` 通过，Core 87、Workspace 9、Host 39、Client 23，共 158 项测试。未在测试环境创建或提交业务数据。

### 当前用户权限与功能入口（2026-09-11）

`/auth/me` 的 `permissions` 现在随已验证身份传给插件；不从角色名称推断管理员全权，也不从浏览器保存的偏好恢复授权。公共 `@oryh/ai-client-core/access` 统一定义插件入口策略：本人待办要求绑定员工；工时/费用按对应 submit_own、advance 或 approval.record 开放本人记录；工时审批要求员工身份及 approval.record；项目要求 master_data.manage 或 users.manage；订单要求 order.submit_own、order.advance 或 approval.record；库存要求 inventory.manage；Shipment 要求 shipment.manage（遵循服务端 inventory.manage 蕴含 shipment.manage）。支持 verb:*，不扩大单个对象 scope 的授权。

根 Slot 仅显示允许的菜单；已持久化但无权访问的菜单不会绕过 Workbench 边界。创建/编辑/提交/审批按钮还要满足具体操作权限、员工归属、单据状态和审批待办分配。Host 拦截业务入口、缓存结果复用、库存查询/产品搜索、工时读写和费用正式操作；Chat 导航及工时建议使用相同权限检查。正式确认重新验证权限，撤权后的旧确认不会写入。

前端在首次连接/切换账号、窗口重新获得焦点、每 60 秒重新验证；核验失败时不展示业务页面。全局布局只接收允许菜单清单，身份及权限不写入显示偏好。继续复用 Harness 公共 Slot、Store 和现有 Typert Remote，不引入第二套框架。

服务端边界：当前 ORYH 部分列表 GET 只实施企业隔离，没有独立的读取权限。上述规则是 ORYH 插件的功能入口限制，不能宣称其他直接 API 客户端也受到同样的读取限制；本次未修改 calwbiz 服务端授权模型。正式写入仍由服务端最终鉴权。

验证：全量构建/类型检查通过；Core 87、Host 39、Workspace 9、Client 23 项测试通过，涵盖缺失权限、角色不授予权限、通配与权限蕴含、撤权后的 Remote 查询/Chat 导航拒绝，以及旧工时确认不能执行。

### 升级后实测发现的两个缺陷（2026-09-12）

**模型调用全部 412。** 升级到 0.1.5-rc.2 后，原生会话每一轮都以 `DeepSeek API error (HTTP 412)` 失败。原因不在 Harness 的线协议，而在模型目录：旧基线 `c389f96bf3` 的目录首项是 `deepseek-v4-flash`，0.1.5 在最前面新增了 `deepseek-flash`（显示名 DeepSeek-V41-Flash），界面默认选中这一项。本机模型 Base URL 指向第三方中转，该中转不接受这个新 id。把会话模型切换为 DeepSeek-V4-Flash 后立即恢复，模型正常调用 `oryh_open_timesheet`。reasoning effort 与此无关（Off 同样失败）。升级 DSH 时需要复核默认选中的模型 id 是否仍被所用的模型服务接受。

**未先核验就读取连接的业务方法。** `timesheetHistory`、`timesheetOptions` 与 `expenseList`、`expenseOptions`、`expenseSave`、`expenseUpload`、`expenseDelete` 直接经 `scope()`（`expenseDelete` 经 `read()`）调用 `requireVerified`，没有像同类读取那样先 `await verify()`。`projectPrepare` 与 `projectConfirm` 经 `authorize()` → `projectOptions` 已覆盖，`records`、`todo-detail` 与其余工时方法在入口即核验。客户端在挂载、窗口获得焦点和每 60 秒都会重新核验，而 `verifyIdentity` 会先撤销已核验状态、再 await 一次 `/auth/me` 往返，成功后才重新标记。任何未经 await 的读取只要落入这个窗口就抛 `connection-verification-required`。实测证据：同一次工时面板刷新中，`timesheetList` 返回 `ok:true` 和三条真实工时，`timesheetHistory` 同时返回 `connection-verification-required`；面板用 `Promise.all` 聚合，一个失败即整体 reject，已成功的列表数据被丢弃，界面显示告警加“暂无记录”。四处均改为先 `await verify()`。该问题由 2026-09-11 的权限改动引入，与本次布局迁移无关。

### 收口：默认模型、补丁检查与包说明（2026-09-12）

`dsh-base` 把新 Agent 的默认模型写死为 `deepseek-flash`（V41），中转型 DeepSeek 端点会以 412 拒绝。ORYH 的 bundle patch 现在覆盖 `agent-default-model` 行为 `deepseek-v4-flash`；patch 会整体替换该行 config，所以 provider 与 model 两个键都完整重写。注意优先级：该插件把组合配置作为设置区的默认值，随后通过 `setSource` 实时读用户层，因此 `settings.yaml` 里已保存的选择仍然优先——覆盖只对全新 profile 生效，已有 profile 要在界面或设置文件里改。

外部 Remote 符号补丁仍未进入上游，DSH 同步会静默丢弃它，而生成器随后只是跳过被装饰的方法、不会报错。`scripts/check-dsh-patch.mjs` 在 `build` 首步检查链接到的生成器源码是否含该修复，缺失即失败并打印重新应用的命令。

`@oryh/dsh-bundle`、`@oryh/dsh-host` 与 `@oryh/dsh-client` 的 README 此前仍写着“没有方法注册为模型工具”“Chat 驱动的查询与填写尚未启用”，与 16 个已注册工具、按 Agent 的工具白名单、`tools/pre-execute` 拒绝其余工具以及页面命令回执的现状不符，已按当前行为改写。工具数按源码核对：15 个字面量名加 1 个经 `toolName` 常量注册，与白名单的 16 个名字一致。

验证：`pnpm run verify` 通过，158 项测试；在临时 `DSH_HOME` 安装 profile 并 `--dump-config`，组合结果中 `agent-default-model` 行标注为 “patched by @oryh/dsh-bundle”，config 为 `provider: deepseek-official` 与 `model: deepseek-v4-flash`。bundle 行的覆盖不改变任何已保存的用户设置。

### 端到端基线：Chat 新建并填写工时（2026-09-12）

在修复后的客户端上用真实测试企业连接与 DeepSeek-V4-Flash 录制。先说“帮我新建一条工时”，模型按提示词先调用 `oryh_open_timesheet` 打开右侧表单；补充“2026-09-14 到 2026-09-18，项目选装配产线自动化技改，每天 8 小时正常工时，工作内容写产线调试”后，模型调用 `oryh_timesheet_propose`（`revision: 5`，`kind: create`），页面按版本校验后写入未保存表单。

结果：右侧“新建工时单”表单显示开始日期 2026-09-14、结束日期 2026-09-18、原始工作说明“装配产线自动化技改项目，产线调试，每天8小时”，以及 09-14 至 09-18 五条明细，每条 8 小时、正常工时、项目“装配产线自动化技改”、任务“产线调试”，合计 40 小时；页面保持“未保存修改”保护与“放弃未保存修改”入口。模型明确说明保存与提交仍需用户在页面确认。全程未保存、未提交、未审批，未向测试企业写入任何业务数据。

该记录作为通道改造（第 1 步）前的行为基线：工具调用顺序、表单版本校验与“填入但未保存”的边界在改造后必须保持一致。

### 端到端基线：Chat 给库存流水加产品列（2026-09-12）

同一会话切到“库存流水”，初始显示列为变动原因、库存项编号、现存数量变动、可承诺数量变动、生效时间，没有产品编码。说“库存流水列表加上产品列，原来的列保留”后，模型调用 `oryh_record_columns`，参数是包含原有列在内的完整列顺序（`reason`、`inventory_item_id`、`quantity_on_hand_diff`、`available_quantity_diff`… 加新增列），不是只传新增项。

结果：表格列顺序变为原五列加末尾“产品编码”，各行显示真实值 PT-HEAD、PT-MOTOR、PT-RIBBON，与各自库存项对应；页面“显示列”勾选区同步出现产品编码，与 Chat 共用同一套列状态。未修改任何业务数据。

该记录同样是第 1 步的对照基线：命令必须携带完整列顺序、页面回执吻合后工具才报成功、传统“显示列”与 Chat 共用同一入口，这三点在改造后必须保持。

### 第 1 步（下半）：四个轮询合并为一条命令流（2026-09-12）

浏览器原本有四个轮询循环：chat-navigation 的 `chatHomePoll` 600ms、todo-chat 的 `chatHomePoll` 350ms、`timesheetChatPoll` 350ms、`projectChatPoll` 350ms。现在统一为一条 Host 流：`@Remote({mode:'stream'}) commands(request, signal): AsyncIterable<CommandFrame>`。生成器确实接受外部插件的流方法，产物里有 `commands: (request, signal?) => AsyncIterable<CommandFrame>` 与 `'oryh/commands'`。

帧是整集快照而非增量：`CommandFrame = CommandBaseline | CommandUpdate`，两者都带完整的 `CommandSnapshot{navigation?, timesheet?, project?}`。待发命令最多三条，整集没有排序和去重问题，客户端本来就按 id 去重；重连只需重发 baseline，不会重放也不会丢。注意必须是可辨识联合，写成 `type:'baseline'|'update'` 的单一 interface 时 `Extract` 无法收窄。

Host：`CommandQueue` 增加 `subscribe`/`changed`，`issue`、`withdraw`、`clear` 以及两个子对象暂存或清除建议时都触发；`BusinessChat.commands()` 先发 baseline，其后每次变更发整集，并在每帧前重读绑定，会话离开页面即结束。`homePoll`、`timesheet.poll`、`project.poll` 及对应的三个 `@Remote` 已删除；`snapshot(sessionId)` 转为公开方法，作为测试与流共同的观测点，避免为测试保留一个生产环境不再使用的方法。

客户端：新增 `command-stream.tsx`。`CommandStream` provider 先 `chatSelect({homeOnly:true})` 绑定会话、再开流，卸载时 dispose 并 `chatHomeClear`；顺序不能颠倒，Host 对未绑定会话直接拒绝，而拒绝是终态不会重试。四个视图改用 `useCommands()` 读同一份快照。provider 放在 `workbench.tsx`，因为只有那里同时拿得到 `connection` 和全部四个消费者；`sessionId` 走 props 而不是 `BusinessSessionContext`，否则 command-stream 与 todo-chat 形成运行时循环引用。

**跨插件值引用是被显式管控的，不是不可能——原先的结论过宽（2026-09-12 更正）。** 最初直接 `import { RemoteSnapshotStream, RemoteStreamCarrierError }`，四个工程 `tsc` 全部通过，但 esbuild 警告 `Import "RemoteSnapshotStream" will always be undefined because .../gateway/lib/client.js has no exports`。当时据此记为"外部插件只能引用 Harness 的类型，不能引用它的值"。评审指出这条过宽，复核后确认评审正确，真实情况是：

核对版本为本机 Harness `0.1.5-rc.2` / `c291e7961a`，`@deepseek-ai/dsh-api-gateway` 同版本。证据链：

- `RemoteSnapshotStream` 确实是公开导出（`packages/api/gateway/src/client/index.ts:45`，`lib/types/client/index.d.ts:15`），并且**存在于构建产物**：`lib/client.js` 结尾是 `exports.RemoteSnapshotStream = RemoteSnapshotStream; return module.exports`。
- 该产物没有任何 ESM `export`，整体是 `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-api-gateway", factory: (require) => {...} })`。
- 加载器对注册与请求两侧都做 `stripClientSuffix`（`packages/client/modules/src/client/manifest.ts:202`），`'…/client'` 会归一成裸包名，因此 `require('@deepseek-ai/dsh-api-gateway/client')` **能**命中上面那个工厂。
- Harness 自己的客户端预设有一道 `dsh-client-bundle-purity` 门禁：未申报的 `@deepseek-ai` 值引用直接构建报错，申报途径是包清单里的 `dsh.client.external`（`packages/client/tsdown.client.ts`）。也就是说平台把这件事设计成"需申报"，不是"禁止"。

因此警告的**真实原因是我们自己的构建配置**：`scripts/build-dsh-client.mjs:9` 的 external 名单只有 react、cordis、dsh-client-store，没有 gateway，于是 esbuild 把那个 `__ModuleLoader__.load` 注册文件当普通模块内联，而它没有 ESM 导出，具名导入自然是 undefined。我们的 web 包也没有 `tsdown.config.ts`，不走 Harness 预设，所以既没吃到门禁报错，也没拿到 external 归一。

**运行时验证已完成（2026-09-12）。** 加载器 `mode` 进入 `live` 后模块表不在全局上，控制台取不到证，所以只能改配置后重建实测：把 `@deepseek-ai/dsh-api-gateway/client` 加进 `build-dsh-client.mjs` 的 external，临时加一个顶层静态值导入的探针（故意用生产代码会用的写法，这样失败就是真答案而不是探针的假象），重建后产物里出现 `require("@deepseek-ai/dsh-api-gateway/client")`，esbuild 不再告警。重启客户端后探针结果：

```
{ snapshotStream: "function", stream: "function",
  carrierError: "function", carrierIsError: "Error: probe" }
```

三个类都拿到了真值，`new RemoteStreamCarrierError('probe')` 也确实是 `Error` 实例，而且 ORYH 插件照常挂载、页面正常渲染。**结论：评审正确，原记录错误，修复只是 external 名单里的一行。** 探针随后删除，external 条目保留（下一步要用）。

一处类型陷阱：裸包名的类型指向 Host 半边（`lib/types/index.d.ts`，不导出 `RemoteSnapshotStream`），所以源码要写 `/client` 子路径（类型才对），运行时由 `stripClientSuffix` 归一。

**更要紧的发现：大部分复用根本不需要值导入。** `ClientRemote.$stream<Item>(options): RemoteStream<Item>` 是服务上的方法，`ctx.remote.$stream({name, open, ended, carrierFailed})` 直接就能拿到一条由 Connection 调度重连的流——物理重试时机、carrier 失败分类都在里面。`RemoteStream` 与 `RemoteSnapshotStream` 作为**类型**引用即可；真正需要值的只有 `RemoteStreamCarrierError`，因为 `ended(accepted): Error` 必须**返回**一个错误对象，用它才能把"正常结束"标成可重试。这正是原记录里写的那个缺口，现在已证明可达。

`RemoteSnapshotStream` 的契约与我们的需求吻合得出奇：`isSnapshot` 正是 `CommandFrame` 当初被改成可辨识联合的原因，`replace`/`update`/`failed` 对应整集替换、增量与终态发布，而文档明写"底层流重试期间上一份快照保持已发布"——就是评审 §2 要求的"终态不应继续发布旧的待执行命令"的反面保证。

当前代价（未变，但原因要改记）：重连循环仍是自行实现、固定 1 秒重开。原因是"external 未申报"，**不是"平台不允许"**。这一条先前被归到"转发事件是封闭白名单""自定义 SessionEventMap 会破坏会话重载"那一类外部插件边界里，现在看归类是错的：那两条是真边界，这一条是我们自己的构建配置。下一步（评审 §2）应改用 `remote.$stream` 重写，而不是继续加固自写循环。

已全仓审计：客户端源码其余非类型的 `@deepseek-ai` 引用只有 `dsh-client-store`（在 external 名单内）与 layout.spec 的两个（spec 不进 bundle），所以今天没有重复运行时实例的隐患。

验证：`pnpm run verify` 通过，Core 87、Workspace 9、Host 41、Client 23，esbuild 无警告。Host 新增流测试：开流发 baseline、变更后发整集、重连的 baseline 仍携带页面未消费的命令、未绑定会话被拒。

### 两条基线在改造后的回放（2026-09-12）

重启客户端（旧进程仍持有改造前的 Host 代码，必须先杀掉）后，用同一测试企业回放。

工时：新开会话说"帮我新建一条工时"，右侧从"我的待办"切到"我的工时"并打开新建工时单，出现 `timesheetChatSync` 成功后才会显示的"描述工作内容即可自动填写右侧表单"。补充日期、项目与工时后，实测表单字段为 2026-09-14/2026-09-18、原始说明"装配产线自动化技改项目产线调试"、五条明细各 8 小时 `regular`、项目 577eaa44…（装配产线自动化技改）、任务"产线调试"，合计 40 小时，与基线一致。此处校验的是输入框实际取值，不是页面上那个由取值算出的合计。全程未保存未提交，随后点"放弃未保存修改"清理。

库存流水加产品列：显示列偏好已持久化，页面开局就带着产品编码，等于基线的"之后"状态，直接发指令无法证明任何事；先在"显示列"取消勾选还原成原五列，再说"库存流水列表加上产品列，原来的列保留"。轨迹中的工具参数是 `oryh_record_columns{"columns":["product_code","reason","inventory_item_id","quantity_on_hand_diff","available_to_promise_diff","effective_at"]}`，携带完整列顺序而非只传新增列；页面按该顺序原样渲染，勾选区同步为六列，行值 PT-HEAD、PT-MOTOR 为真实数据。模型回复里还正确复述了改造后重置的五列，说明 `oryh_current_page` 经页面同步读到的是实时状态。

与基线唯一的差异是位置：原记录中产品编码追加在末尾，这次落在首位。轨迹证明是模型自己把 `product_code` 放在参数第一位，页面没有重排，用户要求（原列保留）也已满足，属于模型选择差异而非通道回归。基线真正要保的三点——命令携带完整列顺序、页面回执吻合后工具才报成功、Chat 与"显示列"共用同一套列状态——全部成立。

回放期间浏览器控制台错误计数始终停在 196，全部是杀掉旧服务那段时间产生的 404 与连接拒绝；重新加载、切换会话、两条命令链路都没有新增错误。由于流走 `remote.mux` WebSocket，HTTP 网络面板里看不到 `oryh/commands`，只能靠上述行为证据判断。

副作用：回放把库存流水的持久化列顺序改成了产品编码在首位（原为末位），属于显示偏好，可在"显示列"里调回。

### 剩余步骤计划（按压缩前方案重建，2026-09-12）

第 2–6 步的方案原本只存在于对话里，仓库中没有任何记录，这本身是个风险：多步结构性重构如果只靠记忆推进，无法核对是否偏离原方案。本节按压缩前的要点重建，并用当前代码的实测结果补全细节。**若与原方案不符，以用户更正为准，不要按本节直接施工。**

**页面标识的散落情况（实测）。** 四张互不相同的页面表：`OPERATIONS`（core/operations.ts，3 页，title/description/method/path）、`layout.tsx:87` 的 pages 数组（9 页加 settings，id/文案 key/图标）、`workbench.tsx:46` 的 pages 记录（3 页，title/description/icon）、`business-chat.ts:106` 的 names 映射（10 页，id→中文名，旁边另有 capabilities 三元表达式）。六处字面量 id 列表：`AccessPage`、`app.tsx:46`、`oryh_navigate` 工具的 enum、`ChatPageRequest['page']`、`saved-operations.ts:218`、`BusinessView`。七处以上 switch：`controller.ts` 四处、`OperationExecutor` 一处、`business-chat.ts` 的 pageSync 命令→页面三元与 pageData 分发。其中 `core/remote.ts` 的两个 switch 每个 case 主体看起来完全相同，最初被判断为纯噪音。**实测后更正**：`OryhClientController.execute`/`reuse` 只公开三个字面量重载，联合类型那一条是实现签名、外部不可调用，因此这两个 switch 的作用是把联合窄化到字面量以命中重载，直接删除会导致类型检查失败。这是操作重载的类型问题，与页面标识无关，不在第 2 步处理；要收掉需要另加一条公开的联合重载，属于独立改动。

**第 2 步：抽出 `@oryh/dsh-connections` 与 `@oryh/dsh-workbench`，引入页面登记表。** 一条记录描述一个页面：id、模型可见的中文名、访问规则（identity → boolean），后续可再加确定性操作（method/path/decoder）与 Host 侧能力提示语。`canAccessPage` 的 switch 变成遍历登记表。

菜单文案 key、图标与客户端组件**不进登记表**：登记表必须保持 React-free（否则 React 会进入 core 的依赖图），而文案 key 只有客户端会读、Host 从不使用。客户端改为用 `Record<PageId, …>` 按 id 映射展示信息，顺序与 id 仍来自登记表；这样漏配一个页面或写错 key 是编译错误，比把 key 放进登记表再强制类型转换更安全。

放置位置需要先定：登记表必须同时被 core（access/operations）、dsh-host（工具 enum、capabilities）与 web（侧边栏、workbench、app）引用，因此只能落在三者共同的底层——core 内的新模块，或一个新的最小包。另需注意 Host 那半不只是命名问题：`bindingPage`/`assertPage`/`assertSelectionPage` 是从绑定状态反推页面 id，登记表必须暴露对应的推导钩子，否则只收敛了客户端，Host 的散落原样保留。

退出条件：`canAccessPage` 的 switch 消失；`app.tsx:46` 的字面量页面列表与 `layout.tsx` 的 pages 数组由登记表生成；`oryh_navigate` 的 enum 由登记表生成；`business-chat.ts` 的页面中文名映射由登记表提供；`pnpm run verify` 全绿；两条 E2E 基线回放与上一节一致。（原先还列了"删除 `core/remote.ts` 两个恒等 switch"，经实测更正后移出本步，理由见上。）

**第 3 步：records 试点。** 先迁 `sales-orders`、`inventory-items`、`inventory-item-details`、`shipments` 四个只读列表，用真实业务域验证登记表的形状。只读页面出错代价最小，适合作为第一块。

抽包深度已定为**窄结构接口 + 下沉 errors**（2026-09-12 用户选择）。实测依据：`host.ts` 已经是组合根，五个领域服务都只接收 `http` 与 `verify`/`current` 两个回调，所以 `RecordService` 只需自己声明最小结构接口——`request(id, { path: \`/${string}\` })` 与 `{ origin, identity }`；注意 `OryhRequest.path` 是模板字面量类型而不是 `string`，写成 `string` 会在注入点而不是包内报错。唯一真正的值依赖是 `OryhClientError`。

为此新增零依赖包 `@oryh/ai-client-foundation`（`packages/foundation`），装 `errors.ts` 与 `brand.ts`。它必须位于 core 与 records 之下，因为每个领域服务都抛 `OryhClientError`。`brand.ts` 的品牌基于 `unique symbol`，core 只能**再导出**不能重新声明，否则两侧的标识类型互不兼容，所有 `id as ConnectionId` 都会失效。

连带结果：第 2 步把 `requirePage`/`requirePermission` 留在 core，只是因为 `OryhClientError` 当时在 core；errors 下沉后该约束消失，抛错守卫可以并入 `pages`（`pages` 转而依赖 foundation），使访问策略只有一个家，`core/access.ts` 退化为纯再导出。

关于 `@oryh/dsh-connections` 与 `@oryh/dsh-workbench`：第 2 步的标题提到这两个包，但正文与退出条件从未定义它们装什么，实际也没有抽出。records 试点正是同一个抽包动作，因此先用它验证模式，再回头定义这两个包的边界。

**第 4 步：timesheets。** 工时是唯一同时涉及导航命令、表单建议、审批队列和回执等待的域，是登记表最强的压力测试。

**第 5 步：projects、todos、expenses，并删除旧包。** 全部迁完再删，避免中途出现两套并存的事实来源。

**第 6 步（可选）：agent preset。** 把工具白名单与提示词收进 preset。

每一步都以 `pnpm run verify` 全绿加两条 E2E 基线回放作为退出条件；基线不一致时必须先解释差异来源，再决定是否属于回归（如第 1 步中产品编码位置的差异，经轨迹确认来自模型选择而非通道）。

### 第 2 步：页面登记表与 `@oryh/ai-client-pages`（2026-09-12）

新增零依赖包 `@oryh/ai-client-pages`（`packages/pages`），作为 core、dsh-host 与 web 共同的底层。

**依赖环的规避。** 登记表的访问规则需要身份类型，而 `OryhIdentity` 在 core；但 core 必须依赖登记表（`access.ts`、`operations.ts` 正是被替换的对象），直接引用就形成 `pages → core → pages`。解法是登记表只声明它真正读取的最小结构：`{ readonly permissions?: readonly string[]; readonly user: { readonly employeeId: string | null } }`，`OryhIdentity` 结构上满足它。注意 `exactOptionalPropertyTypes: true` 下可选属性要逐字对齐，`permissions` 的 optional 与 readonly 都不能省。

**搬什么、不搬什么。** 纯谓词 `hasPermission`、`canAccessPage` 迁入登记表；抛错的 `requirePage`、`requirePermission` 留在 core——它们抛 `OryhClientError`，跟着搬会把环从另一个方向接上。`hasPermission` 必须一起搬：它带着"`inventory.manage` 蕴含 `shipment.manage`"这条业务规则，登记表的访问规则要调用它，留在 core 就得复制一份。

`core/src/access.ts` 改为从登记表再导出这两个谓词，而 `core/src/index.ts` 本来就是 `export * from './access.js'`，因此**全部 11 处引用一行未改**，迁移不是破坏性的。`packages/core/tests/access.spec.ts` 未经改动仍然通过，这是行为未变的证据——刻意不去动它，否则就成了为迁移而改的测试。

**菜单文案 key 与图标不进登记表。** 登记表必须 React-free（否则 React 进入 core 的依赖图），而文案 key 只有客户端会读、Host 从不使用；放进登记表就得在 `t()` 处强制类型转换，再补一个运行时测试兜底。改为客户端持有 `Record<PageId, { label: OryhKey; icon }>`，顺序与 id 仍来自 `PAGES`：漏配页面或写错 key 直接是编译错误，强于"强转 + 测试"。实测也证明了这一点——`settings` 的文案 key 是 `text15`，而从 `workbench.tsx` 的用法容易误推成 `text17`。

**收掉的重复。** `canAccessPage` 的 switch 变成遍历登记表；`app.tsx:46` 的十个字面量页面 id 变成 `allowedPages(identity)`；`layout.tsx` 手排的十项数组改由 `PAGES` 生成；`oryh_navigate` 的 enum 变成 `pageIds()`；`business-chat.ts` 的页面中文名映射变成 `pageById(id)?.title`。原先的四张页面表只剩一张——客户端的展示映射，且由编译器强制完整。

验证：`pnpm run verify` 通过，Pages 6、Core 87、Workspace 9、Host 41、Client 23，esbuild 无警告。`pnpm --filter @oryh/dsh-host... build` 的范围自动从 2 个包变成 3 个，无需改构建脚本。

### 第 2 步的基线回放与一个模型缺陷（2026-09-12）

重启客户端后回放两条基线；侧边栏十个菜单项标签与改造前完全一致（各页面的文案 key 原样保留，标签若有漂移即说明映射写错）。

**库存流水加产品列：通过。** 显示列偏好已持久化，页面开局就带着产品编码，先取消勾选还原成原五列再发指令。轨迹参数为 `oryh_record_columns{"columns":["product_code","reason","inventory_item_id","quantity_on_hand_diff","available_to_promise_diff","effective_at"]}`，携带完整六列顺序；模型自己把 `product_code` 放在首位，页面原样渲染，勾选区同步为六列，行值 PT-HEAD、PT-MOTOR 为真实数据。模型还正确复述了刚被重置的五列，说明 `oryh_current_page` 读到的是实时页面。与第 1 步结论一致：位置差异来自模型选择，登记表没有重排。

**工时：通道通过，但模型把项目选错了。** 导航与打开表单正常（从"库存流水"跨页切到"我的工时"，出现同步成功才显示的提示语），五条明细的日期、每天 8 小时、正常工时、任务"产线调试"、合计 40 小时均与基线一致。但用户明确说"项目选装配产线自动化技改"，轨迹里模型的叙述也写着"项目：装配产线自动化技改"，它发出的 `project_id` 却是 `7ef94480…`（JC-900 量产导入），不是 `577eaa44…`（装配产线自动化技改）。

这不是本次改造的回归：错误值产生在模型的工具参数里，页面原样渲染了收到的内容；Host 的校验只能确认 `project_id` 在可用项目列表内，无法判断用户想要哪一个；本次改动也没有触及 `oryh_timesheet_read` 的选项或 `oryh_timesheet_propose` 的校验；控制台错误计数全程停在 200。

**更值得单独修的是后半段**：模型随后对用户总结说五条明细的项目都是"装配产线自动化技改"，与表单实际内容不符。一个结构性原因是 `oryh_timesheet_propose` 的回执只有 `{"message":"右侧工时表单已更新，尚未保存。"}`，不含实际写入内容，模型只能照自己的意图复述，于是"有效但选错"的编号被当成正确的讲了回去。让回执带上实际生效的项目名称等字段，可以把总结锚定在真实结果上。这条与通道改造无关，单独记录。

副作用：库存流水的持久化列顺序仍是产品编码在首位，与本次回放前相同。

### 第 3 步：records 抽包与 `@oryh/ai-client-foundation`（2026-09-12）

新增两个包：`@oryh/ai-client-foundation`（`packages/foundation`，零依赖）装 `errors.ts` 与 `brand.ts`——每个领域服务都抛 `OryhClientError`，所以它必须位于 core 与各领域包之下；`@oryh/ai-client-records`（`packages/records`）装 `contracts`、`views`、`service`、`inventory-product-query` 与两个 spec，只依赖 foundation 与 pages。

**破环靠窄结构接口。** `RecordService` 原本依赖 core 的 `OryhHttpClient`、`ConnectionSummary`、`OryhClientError` 与 `requirePage`，而 `host.ts` 又构造它，直接抽出就是 `core → records → core`。实测发现 `host.ts` 已是组合根，五个领域服务都只接收 `http` 与两个回调，因此 records 自己声明 `RecordHttp`（只有 `request(id,{path})`）与 `RecordConnection`（只有 `origin` 与 `identity`），`host.ts:66` 注入真实对象靠方法参数双变性通过。注意 `OryhRequest.path` 是模板字面量 `` `/${string}` `` 而不是 `string`，声明错了会在注入点而非包内报错。

**`brand.ts` 只能再导出，不能重新声明。** 品牌基于 `declare const ORYH_ID: unique symbol`；core 若重新声明，两侧的 `ConnectionId` 互不兼容，所有 `id as ConnectionId` 都会失效。

**抛错守卫并入 `pages`。** 第 2 步把 `requirePage`/`requirePermission` 留在 core，只因 `OryhClientError` 当时在 core；errors 下沉后该约束消失，两者迁入 `pages`，`core/access.ts` 退化为纯再导出，访问策略只剩一个家。

**迁移不是破坏性的。** core 的 `record-contracts.ts`、`record-views.ts`、`records.ts`、`errors.ts`、`brand.ts`、`access.ts` 全部改为再导出，`@oryh/ai-client-core/views` 与 `export * from './index.js'` 原样可用；`packages/core/tests/access.spec.ts` 一行未改仍然通过，是行为未变的见证。

**兼容 shim 会掩盖没搬干净的引用。** 重指 web 与 dsh-host 的导入后构建全绿——但那只说明 shim 还在，并不说明依赖边真的移动了。用 grep 扫一遍，又找出四处仍从 core 取记录符号的位置（`web/remote.ts`、`web/product-picker.tsx`、`business-chat.ts:162`、`dsh-host/remote.ts`）。**结论：带兼容 shim 的搬迁，编译器无法告诉你边有没有移动，只能靠文本扫描核对。**

**浏览器包体。** web 改为从 records 包根导入（原先是 `core/views` 子路径），而包根会再导出 service，因此给 records 加上 `"sideEffects": false`，让打包器能安全摇掉 `RecordService`。esbuild 无警告。

验证：`pnpm run verify` 通过；`@oryh/dsh-host...` 的构建范围自动从 4/8 变成 5/9。测试守恒：Core 87 → 73、Records 14，73+14=87，说明测试是搬走而不是丢失（我先前估成 72/15，是把 `records.spec.ts` 数成 10 项，实际 9 项）。

### 第 3 步的基线回放（2026-09-12）

**库存流水加产品列：通过。** 先取消勾选还原成原五列再发指令。轨迹参数为 `oryh_record_columns{"columns":["product_code","reason","inventory_item_id","quantity_on_hand_diff","available_to_promise_diff","effective_at"]}`，携带完整六列顺序；模型自己把 `product_code` 放在首位，抽包后的 `recordColumns`/`recordSpecs` 没有重排。模型还正确复述了刚被重置的五列，说明可用列目录（现由 records 包提供）正确。另外页面加载时 `/api/oryh/recordList` 就已返回 200，抽出的 `RecordService` 经真实 Host 可用。

**工时：通过，且项目填对了。** 从"库存流水"跨页切到"我的工时"并打开新建工时单，五条明细为 09-14 至 09-18、每天 8 小时、正常工时、任务"产线调试"、合计 40 小时，项目为 `577eaa44…`（装配产线自动化技改），与原始基线完全一致。**第 2 步回放中填错项目（JC-900 量产导入）这次没有复现。** ⚠️ 后续更正：第 5 步回放中它又复现了一次，四次回放里两次填错。当时写的"印证了不是系统性缺陷"低估了频率——用一次没复现去论证无害，与本文档批评模型"照自己的意图复述"是同一种错误。它确实不是代码缺陷（每次都有轨迹证明错值出自模型的工具参数），但发生率接近一半，详见第 5 步。`oryh_timesheet_propose` 的回执仍不含实际写入内容，该改进建议依然成立。

全程控制台错误计数停在 203，新增的 3 条来自杀掉旧服务到重新导航之间的窗口。未保存、未提交，随后放弃未保存修改。

遗留（不在第 3 步范围内）：`records.tsx` 的 `recordTitles` 与登记表标题重复且已漂移（`Shipment · 收发货` vs `Shipment 收发货`）；`records.tsx` 从 `workbench.tsx` 导入 `PageContext`、而 `workbench` 又导入 `RecordPanel`，是一处仅类型的循环引用；`@oryh/dsh-connections` 与 `@oryh/dsh-workbench` 的边界仍待定义。

### 第 4 步：timesheets 抽包与 `@oryh/ai-client-store`（2026-09-12）

工时域比 records 复杂，records 的模式不能直接套用，调研中发现三件事。

**存储原语必须单独成包。** `EncryptedRevisionStore<T>` 写在 `timesheet-store.ts` 里，但 `local-runtime.ts` 直接用它装项目数据（`EncryptedRevisionStore<ProjectRecord>`），`EncryptedTimesheetStore` 只是它的子类。若让它随工时域搬走，项目就要从 timesheets 包取存储；留在 core 又会形成 `local-runtime → timesheets → core` 的环；放进 foundation 则要把 `@napi-rs/keyring` 带进那个"零依赖"包。三条路里只有第四条成立：新建 `@oryh/ai-client-store`（`packages/store`）。顺带确认 `EncryptedExpenseStore` **不是**它的子类，而是另写了一份近乎相同的 AES-GCM 实现——两份约 90 行的重复，合并是单独的一件事。

**两处跨域泄漏。** 其一，`timesheets.ts` 从 `expense-contracts.js` 借用 `object()`，因此工时响应格式错误时抛的是 `expenseError('费用数据无效。')`、code 为 `expense-conflict`。其二，`EncryptedRevisionStore` 内部一律抛 `timesheetError`，于是项目存储失败会报成工时冲突。

两处的处理**故意不同**，理由是代价不对称：存储原语只要保留原有 code，成本就是一个带注释的常量，因此按"搬迁不改行为"原则原样保留，把问题记录下来另行修正；而 `object()` 若要保留原样，就得把费用域的错误构造函数复制进 timesheets 包——那正与抽包的目的相反，且任何后来者都会把它当成错误。核对过没有任何测试或消费者观察过这个 code（`费用数据无效` 全仓只出现在构造处），因此 timesheets 包改用自己的 `object()` 抛 `timesheetError('工时数据无效。')`，并在新包的 spec 中固定这一行为，避免旧的跨域错误悄悄回来。

**不是所有测试都跟着域走。** `core/tests/timesheets.spec.ts`（15 项）构造的是**真实**的 `OryhHttpClient` 与 `ConnectionRegistry`，是一条贯穿 core 传输层、凭据注入、分页与服务本身的集成测试。搬到 timesheets 包要么让 core 成为它的 devDependency（成环且方向相反），要么把真实传输换成假对象——那会把全套里最强的一条测试掏空。因此它留在 core，经 shim 引用 `TimesheetService`，一行未改仍然通过，继续充当行为见证。**规则：单元测试随域走，贯穿 core 传输层的集成测试留在 core。** 新包另写了 5 项聚焦测试（字段规则、`object()` 的更正、未关联员工的拒绝）。

**一个与第 3 步相反的失败。** 第 3 步的教训是"兼容 shim 会掩盖没搬干净的引用，编译器发现不了"。这次拆分混合导入时把 `ConnectionId`/`OryhClientError` 指向了 foundation，却只给 dsh-host 加了 timesheets 依赖、漏了 foundation，于是 `TS2307 Cannot find module` 当场失败。同一次改动里两种方向：**指错了编译器不报，声明漏了编译器才报**，所以两件事都要做——重指之后扫一遍，以及确认新边所需的依赖都已声明。

`RecordHttp` 只需要 `request(id,{path})`，`TimesheetHttp` 则要完整的 `{path, method, body, retryExpired}`：工时是写入域。web 对 timesheets 包全部是 `import type`，编译期即擦除，所以 `service.ts` 里的 `node:crypto` 不会进浏览器包；records 当初需要 `sideEffects:false` 是因为那是值导入。

验证：`pnpm run verify` 通过，构建范围 6/10 → 7/11，esbuild 无警告。Pages 6、Timesheets 5、Records 14、Core 73、Workspace 9、Host 41、Client 23。

### 第 4 步的基线回放（2026-09-12）

页面加载时 `/api/oryh/timesheetList`、`timesheetOptions`、`timesheetHistory` 均返回 200，抽出的 `TimesheetService` 经真实 Host 已可用。

**工时：通过，项目正确。** 从"我的工时"新建，五条明细为 09-14 至 09-18、每天 8 小时、正常工时、任务"产线调试"、合计 40 小时，项目为 `577eaa44…`（装配产线自动化技改），与原始基线一致。这条路径正是本步搬走的代码：`oryh_timesheet_propose` → `TimesheetService.timesheetPrepare` → `validateTimesheet` → store，现在跑在结构接口与自带的 `object()` 上，结果逐字相同。

**库存流水加产品列：通过。** 先还原成原五列再发指令，产品编码追加回来、原五列保留、勾选区同步为六列、行值为真实数据。records 本步未改动，这条用于确认工时抽包没有波及邻域。

全程控制台错误计数停在 209（新增 6 条来自杀掉旧服务到重新导航之间的窗口）。未保存、未提交，随后放弃未保存修改。

遗留：`EncryptedExpenseStore` 与 `EncryptedRevisionStore` 的重复实现；`EncryptedRevisionStore` 对项目存储抛工时错误码；以及第 3 步列出的那几项。

### 第 5 步：todos、projects、expenses 抽包并删除兼容层（2026-09-12）

三个域一次抽出，随后做一次集中的重指与删除。工作区从 5 个包变成 14 个，`packages/core/src` 从 30 个文件降到 18 个——只剩连接、凭据、HTTP、确定性操作与组合根，也就是 core 本来该是的样子。

**`object()` 的借用比第 4 步发现的更广。** 不只是 timesheets，`projects.ts` 与 `todo-detail.ts` 也从 `expense-contracts.js` 借用它，所以项目与待办响应格式错误时同样报的是 `expense-conflict`／"费用数据无效"。三个域现在各有自己的两行实现：projects 用 `request-failed`，todos 用 `invalid-response`（该服务本来就用这个码报"关联单据与待办不匹配"），expenses 保留原版——那里错误本来就是对的。每个新包都用测试把更正后的码钉住，防止跨域错误悄悄回来。

**"单元测试随域走，贯穿 core 传输层的集成测试留在 core"已经四比零成立。** timesheets、todos、projects、expenses 的 spec 全都构造真实的 `ConnectionRegistry`、`MemoryCredentialVault` 与 `OryhHttpClient`（todo-detail 的第二块还整个搭起 `OryhClientHost` 验证并发核验只做一次）。四条都留在 core，改为从各自包里引入服务、从 core 引入传输层，一共 73 项仍然通过，继续充当行为见证。各新包另写聚焦单元测试：todos 6（其中把**字段白名单**单独钉住——它是阻止凭据与自定义字段进入 chat 的那道闸，此前只被集成测试间接覆盖）、projects 4、expenses 7。

**38 行也值得独立成包。** `todo-detail.ts` 很小，但它带着路由表和字段白名单，是有安全含义的领域逻辑而不是胶水；若因为"小"而留在 core，本阶段"core 化整为零"的终点就被悄悄打了折。

**删除兼容层本身就是重指完整性的证明。** 这是本步最有用的一条：有 shim 在，漏掉的引用照样编译通过，编译器不会告诉你依赖边没有移动（第 3 步的教训）。所以顺序是——先把全部消费者重指，再删掉 12 个域 shim，让构建来裁决。结果立刻抓到三处遗漏：`dsh-host/src/remote.ts` 的 `ExpenseDraft`、`ExpenseFields`、`OryhExpenseRemote`，报错精确到行。

**为什么会漏。** 我先做了一份 41 处引用的清单，但那是**按行**扫的，而这三个符号在一个跨行的 `import type { … }` 块里——清单只看到第 19 行那个孤零零的 `} from '@oryh/ai-client-core'`。**结论：基于 grep 的引用清单对跨行导入是结构性失明的；真正的验证是把兼容层删掉。** 修好后又专门搜了一遍跨行导入块，确认全仓只有那一处。

拆分时还要按目的分辨同一行里的符号：`ConnectionId`、`DeviceAuthorizationId`、`OperationResultId`、`SavedOperationId` 都是已下沉 foundation 的品牌类型，而紧挨着的 `OperationId` 属于 `operations.ts`、留在 core；`OryhProject`、`OryhTodo`、`OryhExpenseClaim` 看着像领域类型，其实是确定性操作的 API 信封解码器，也留在 core。

`core/package.json` 的 `./views` 子路径随 `record-views.ts` 一起删除。`errors.ts`、`brand.ts`、`access.ts` **暂时保留为 shim**：core 自己剩下的十几个文件仍从它们引入，改为直接依赖 foundation／pages 是另一件事，单独记录，不塞进这次搬迁。

验证：`pnpm run verify` 通过，构建范围 10/14、类型检查 13/14，esbuild 无警告，共 188 项测试（todos 6、pages 6、records 14、projects 4、timesheets 5、expenses 7、Core 73、Workspace 9、Host 41、Client 23）。web 对各领域包全部是 `import type`，因此 `node:crypto`、`node:fs` 与 keyring 不会进入浏览器包——esbuild 无警告即是证据。

### 第 5 步的基线回放（2026-09-12）

**库存流水加产品列：通过。** 先还原成原五列再发指令，产品编码追加回来、原五列保留、勾选区同步为六列、行值为真实数据。

**工时：通道通过，但填错项目的缺陷复现了。** 表单五条明细的日期、8 小时、正常工时、任务与合计 40 小时都对，项目却又是 `7ef94480…`（JC-900 量产导入）。轨迹确认错值出自模型自己的工具参数，抽包后的 `TimesheetService` 原样透传——**这正是本次必须查证的假设**：服务已换成结构接口和自带的 `object()`，"抽包过程改坏了 project_id" 是一个真实可能性，不能直接沿用前几次的结论。

**更正频率判断：四次回放两次填错（第 2、5 步错，第 3、4 步对）。** 第 4 步记的"印证了不是系统性缺陷"低估了它。另有一处相关观察（样本只有 4，仅作记录不作结论）：两次填错都发生在模型**先反问、并在反问里列出可选项目**之后；两次填对都是直接从详情消息填写。本次它在反问里甚至把"装配产线自动化技改"列在第一位，随后仍选了 JC-900，所以不是列表顺序问题。这与"回执不带实际写入内容"的改进方向相互印证：让回执回带真正生效的项目名，模型就不必凭自己的意图复述。

全程控制台错误计数停在 212（新增 3 条来自杀掉旧服务到重新导航之间的窗口）。未保存、未提交，随后放弃未保存修改。

### 把 typert 补丁固化进本仓（2026-09-12）

⚠️ **更正（本节初版有错）。** 初版写的是"`check-dsh-patch.mjs` 指向的 `patches/deepseek-harness-external-remote.patch` 从来不存在"。这是错的：该文件自 `777e2a0` 起就在仓库里。我只看到脚本引用了这个路径，就断定它缺失——而验证只需要一条 `ls`。这与本文档里批评模型"照自己的意图复述"是同一种错误，只不过这次是我犯的。

实际情况是这个补丁**过期**了。原文件针对升级前的 `analyzer.ts`，hunk 落在第 1850 行；本次会话把 DSH 升到 0.1.5-rc.2 之后，同一段代码移到了第 1936 行。`git apply` 对上下文有一定容错，未必一定失败，但补丁已不再与目标树对应，而且没有任何东西验证过它。

重新导出后用 `git apply --check --reverse` 验证，确认与当前 DSH 树逐字对应。**所以这次改动的价值是刷新了一个被 DSH 升级弄过期的补丁，不是补上一个不存在的文件。** 顺带得到一条规律：`patches/` 下的补丁与被链接的 DSH 版本是耦合的，每次升级 DSH 都应重新导出并用 `--check --reverse` 验证一次，否则守卫指向的补救手段会悄悄失效。

**没有向上游提交。** DSH 那个仓的 origin 是 `deepseek-ai/deepseek-harness` 上游本身，当前分支是 `master`，而该仓明显走 PR 流程（近期提交清一色是 `Merge pull request #NNNN`）。直接向上游 master 推送既是外部可见的动作，也绕过了它自己的流程，因此补丁留在本仓：风险降为零，"DSH 树被重置就丢失"这个问题也解决了。

DSH 树里另有三个未跟踪的说明文件（`.agents/notes/implemented/bug-fix/2026-09-08-external-plugin-remote-symbols.*`），未纳入补丁；将来若要上游化，那几份说明可以一并带上。这仍是待办：本仓固化只是止血，不等于修复已经进入上游。

## 对评审意见的回应（2026-09-12）

评审稿见 [18-plugin-split-review-2026-09-12.md](18-plugin-split-review-2026-09-12.md)，基线 `plugin-split` / `7c11b42`。该文自述是建议稿、不是实施指令。本节只记录已经动手的部分，其余仍是待办。

### 已修：命令流的通知丢失窗口（评审 §1）

评审说得对，这是我写的真缺陷，而且我自己的测试看不见它。

`BusinessChat.commands()` 原先只用一个 `wake` 回调做交接：生成器 `yield` 一帧之后挂起，此时 `wake` 是 `undefined`；若消费者还在处理这一帧时 `changed()` 触发，回调执行 `wake?.()` 等于空操作，**这次变化没有留下任何待处理痕迹**。消费者随后请求下一帧，生成器转去等待，直到下一次无关变化才醒——对应的现象是命令迟迟不下发、工具等待超时。整集快照只保证重连能恢复，不能消除这个窗口。

改法是加一个 `dirty` 标记与 `wake` 并存：变化先置位 `dirty`，下一轮若已置位就不等待、直接发帧。清位放在读快照**之前**而不是之后——变化若正好落在读快照期间，代价是多发一帧冗余（整集幂等，无害），而清位放在之后则会真的丢掉它。多次变化自然合并成一帧。

验证按评审给的三条验收写了三个测试，都落在 `tests/business-chat.spec.ts` 的 `command stream` 里：

1. 消费 baseline 后、请求下一帧**前**发布命令，下一帧仍能收到，无需后续变化唤醒。
2. 消费者迟缓期间连续两次同 lane 命令，一帧给出与 `snapshot()` 一致的当前整集。
3. 等待中取消、以及刚发出一帧尚未请求下一帧时取消，两种窗口都能结束订阅。

**这三个测试先被证伪过再被证明有效**：临时撤掉 `dirty` 判断后，前两个超时失败，而原有的那条流测试（"开流发 baseline、变更后发整集、重连 re-baseline"）**照样通过**。原因是它在发布命令之前就先调用了 `frames.next()`，正好是唯一不会丢通知的顺序——所以旧测试对这个窗口结构性失明。恢复 `dirty` 后全部通过。

顺带核对了两件事，都没有问题：`queue.changed` 是 navigation / timesheet / project 三个来源唯一的通知通道（子对象暂存与清除都调它），所以单个 `subscribe` 覆盖整份快照；`expiresAt` 与 `timeoutMs` 逐一配对（15000/15000、10000/10000），超时必定伴随 `finally` 里的 `withdraw` 从而触发 `changed`，不存在"命令因时间流逝过期却无人通知"的第二个缺口。

验证：`pnpm run verify` 通过，Host 44（新增 3）。

### 已更正并实测：Harness 值引用的限制被我记过宽（评审 §5）

见上文"跨插件值引用是被显式管控的"。结论：评审正确，我错；真实原因是 `build-dsh-client.mjs` 的 external 名单，不是平台不允许。运行时验证已完成，三个公共流类都可达，且发现 `remote.$stream` 这条连值导入都不需要的复用路径。external 条目已保留，探针已删除。

### 未做（仍是待办）

- §2 异常分类与绑定生命周期：`remote.ts` 把 baseline 前任何异常当终态、`command-stream.tsx` 每 500ms 无差别重试绑定，确实是一对相反的错误，都是我写的。需要统一连接状态与可取消退避，并补客户端流适配器测试。**做法已经清楚**：改用 `remote.$stream`（Connection 调度重连）＋ `RemoteStreamCarrierError`（把正常结束标成可重试），自写的 `createCommandStream` 循环应当删掉而不是加固。
- §3 工时选错项目：同意按正确性缺陷跟踪，工时业务基线在此之前不应记为全部通过。
- §4 领域库还是独立业务插件：这是产品决策，不该由我替用户定。在定下来之前不动 `dsh-connections` / `dsh-workbench` 的边界。
- §5 补丁守卫只看源码注释、以及干净环境构建验证。

### 已修：用 `$stream` 重写命令流，区分断线与业务拒绝（评审 §2）

自写的 `createCommandStream` 循环已删除，改由 Harness 自己的监管实现承担。`remote.$stream({name, open, ended, carrierFailed})` 返回真正的 `RemoteStream`，外层套 `RemoteSnapshotStream`。两处关键语义现在来自平台而不是我的猜测：

- **只有 `RemoteStreamCarrierError` 会重开**，其余任何异常都经 `terminalStreamFailure` 变成终态。这正是评审说的"断线 / 业务拒绝"分界，不必自己判断。
- **重试时机由 Connection 调度**：连接在线时只给一次立即重开，连接断开时订阅 `connection.generation` 等它回来，而不是我原先那个固定 1 秒。`accept()`（`RemoteSnapshotStream` 在 `replace` 成功后调用）会把重试计数归零。

`ended(accepted)` 的取舍：baseline 之后的正常结束意味着 Host 放弃了绑定，标成可重试，用一次重开让 Host 自己说出真实原因（重开会被业务拒绝，于是带着真实消息变成终态）；baseline 之前就结束违反 Host 自己的契约，直接终态。

`CommandState` 增加 `status`：`idle`／`connecting`／`synced`／`reconnecting`／`rejected`。两条行为按评审要求改了方向：`reconnecting` **保留**上一份整集（页面尚未执行的命令不应在重连时闪掉），`rejected` **清空**整集（命令是给页面的指令，流已死还把旧命令当有效指令发布是错的）。

绑定重试：`chatSelect` 失败不再无差别每 500ms 重试。`LocalRemoteError` 增加 `business` 标志（`unwrap` 里 `code === 'oryh/business'` 即业务拒绝），业务拒绝立即停止并发布终态消息，传输失败走有限退避 `[500,1000,2000,4000,8000]`——即使分类错了也会停，不会重试到会话结束。原先那个 `.catch(() => setTimeout(bind, 500))` 连错误消息都丢掉了，用户什么都看不到。

绑定所有权：清理只在**本实例真的绑定成功过**时才发 `chatHomeClear`。原先无条件发，一个从未绑定成功的实例会去撤销当时持有该 Session 的别人的绑定。顺带核对了评审提的顺序风险：Host 的 `select`（第 49 行）与 `homeClear`（第 220 行）都挂在同一条 `this.serial` 链上，单一 carrier 下到达顺序即串行顺序，所以旧清理晚于新绑定这件事在当前实现里不会发生——但这依赖到达顺序且没有任何地方写明，租约/代次标识才能让它显式。**仍按"待验证的生命周期风险"保留，不记为已修复。**

**测试（评审要求的"客户端流适配器测试"）。** 难点是 gateway 的产物是 `__ModuleLoader__.load` 注册脚本，在 Node 里一导入就因 `window` 未定义而抛错——浏览器里有加载器应答，测试环境没有。解法不是写桩（桩只会验证桩自己），而是用包自己的 `./src/*` 导出，在 `vitest.config.ts` 里把 `@deepseek-ai/dsh-api-gateway/client` 别名到 `tests/harness-gateway.ts`，于是测试跑的是**真的** `RemoteStream` 与 `RemoteSnapshotStream`，只伪造 `connection.generation` 和 `open()`。五个测试：baseline 发整集并转 `synced`；首帧前断线能恢复并确实重开过；重连期间上一份整集仍在；非 carrier 失败转 `rejected` 且清空；baseline 之前来 update 触发协议违规。

其中第二个测试做了证伪：把抛出的 `RemoteStreamCarrierError` 换成普通 `Error`，它立刻变成 `{status:'rejected'}` 失败——也就是重写前的行为。这证明分类本身在起作用，而不是测试恰好通过。

验证：`pnpm run verify` 通过，共 196 项（Client 23 → 28），esbuild 无警告。真实客户端重启后复核：插件挂载、库存流水渲染出真实业务数据、无 `not a function` 类错误——说明 `require("@deepseek-ai/dsh-api-gateway/client")` 被加载器应答、`$stream` 构造成功（否则工厂或 provider 的 effect 会抛错，页面不会渲染）。

仍未做：评审要求的"被拒绝状态显示恢复入口"。`rejected` 的消息目前只经由 `timesheet-chat` 既有的 `stream.error` 通道露出，四个状态还没有统一的 UI 呈现——这是产品/交互决策，留给用户定。

### 部分修：工时项目选择与真实回执（评审 §3）

评审的判断接受：这是正确性缺陷，不是抽包引入的偏差，工时业务基线在解决前不应标成全部通过。本节做了其中可以在服务端收口的部分。

**原先只有一道检查**：`l.project_id && !data.options.projects.some(o=>o.id===l.project_id)` —— 只确认编号在可用列表里。一个格式正确、确实存在、但不是用户要的项目，这道检查完全看不见，而这正是四次回放里两次发生的事。

**新增编号与名称的配对校验。** 工具行参数增加 `project_name`（必填），必须逐字等于该编号对应项目的名称：

- 两者都为空 = 不关联项目（文档化的写法）。
- 只给编号不给名称、或只给名称不给编号，都拒绝。
- 名称与编号不符，拒绝并报出编号的**实际**名称与建议里写的名称，要求重新确认、必要时先反问。

原理是让模型对同一个选择做**两次独立陈述**。编号来自它的解析结果，名称来自用户的话；解析错了两者就会对不上。这比单看编号强，但**不是万能**：如果模型把名称也按自己选的编号回填，配对仍然一致——评审自己也说了"回传名称能帮助发现错误，但不能独立阻止选错项目"。

`project_name` 是工具对自身解析的断言，不是表单字段，所以**不进页面**：`pageAction`/`formSnapshot` 在入库前剥掉它，`pageFields`（非 strict，会丢弃多余键）把回执比较的两侧都归一到页面形状——否则用带 `project_name` 的 schema 去解析页面快照会直接失败，回执永远等不到。

**回执改为承载页面实际内容。** 原先成功消息是 `'右侧工时表单已更新，尚未保存。'`，不含任何内容，模型于是按自己的意图复述，错的项目也能被说成确认成功。现在 `applied` 由**页面同步回来的** `state.fields` 生成（不是 `args.action.fields`），包含起止日期、每条明细的项目编号与名称、每日工时与合计；工具说明里明确要求复述必须依据 `applied`、不得复述本次参数。不匹配的分支也给 `applied`，这样"页面变成了别的东西"能直接看出变成了什么。

**同名项目。** 编号＋名称配对挡不住"两个同名项目里挑错一个"。`read` 增加 `ambiguousProjects`（列出重复的名称）并在 `notice` 里要求先反问，不要自行挑选。这是软约束，不是强制。

**测试（11 项，原 6 项）。** 新增：名称与编号不符被拒；编号与名称必须同给或同空；同名项目被标记；**回执反映页面而非请求**——让页面应用成另一个项目和更少工时，断言回执里是 `q`/`另一个项目`/3 小时而不是请求的 `p`/8 小时；匹配时回执正确给出名称、合计与每日工时。另外把"入库的是页面形状"断成显式断言（`not.toHaveProperty('project_name')`）。

这些测试是通过给 `TimesheetChat` 一个能捕获 `ctx.tools.register` 的假 ctx、调用 `install()` 后直接驱动工具的 `execute` 写的，所以覆盖的是真实的工具路径与 `queue.wait` 回执，而不只是 `propose` 内部。

**未做，也不声称已解决：**

- 页面标出本次修改（评审第三条）是 UI 改动，未做。
- **E2E 回放未做。** 这是真正的业务验收，而且单次不复现说明不了问题——上一次我就是凭一次不复现写了"不是系统性缺陷"，随后在第 5 步 4 次里复现 2 次。评审要求分别测试名称解析、ID 映射、页面实际值与工具回执，并覆盖重名、先反问再填写、跨页后填写、用户纠正项目等场景；以上只完成了服务端单元那一半。**工时业务基线仍不标为通过。**

#### 四次回放（2026-09-12，含本次修改的构建）

每次都新开会话，只填写、不保存不提交，未向测试租户写入任何业务数据。为避免"表单里本来就是对的"造成假通过，**每次换一个目标项目**，这样上一轮的残留值一定是错的、能被看出来。

回放前先查了真实项目列表，发现租户里有 **5 个同名的 "Regression Project"**（编号各不相同），另有 "JC-900 量产导入" 与 "装配产线自动化技改" 两个唯一名称。因此先改了 `notice` 的措辞：原文"有同名项目，必须先向用户确认"会让模型对名称唯一的项目也反问，改成只点名真正重复的那些名称，并说明其余不必反问。

| # | 请求 | 页面实际结果 | 判定 |
| --- | --- | --- | --- |
| 1 | 装配产线自动化技改，09-14~09-18，每天 8h | 5 条，全部 `577eaa44…`，合计 40h | 通过 |
| 2 | JC-900 量产导入，09-21~09-23，每天 8h | 3 条，全部 `7ef94480…`，合计 24h | 通过 |
| 3 | Regression Project（5 个同名） | 只调用了 read，**没有填写**，反问用户是哪一个 | 通过 |
| 4 | 装配产线自动化技改，10-05~10-07，每天 7h | 3 条，全部 `577eaa44…`，合计 21h | 通过 |

判定依据是**页面 select 的实际 value**（读 DOM），不是模型的复述。

第 1 次同时确认了两半都在真实环境生效：工具调用里带上了 `project_name`，回执返回了 `applied`（起止日期、`total_hours` 40、每日明细、每条的项目编号与名称）。第 4 次的复述与页面逐项一致（21 小时、3 天 ×7h、装配产线自动化技改），并保持了"尚未保存"的边界。

第 3 次是最有说服力的一次：模型明确说"系统中有 5 个同名项目都叫 Regression Project，没有额外编号或客户信息来区分"，然后停下来反问，而没有从 5 个里挑一个。这正是原先会悄悄选错的那类情形。

**结论要克制。** 四次零复现（原先 4 次里 2 次）是有意义的证据，但**不是证明**：若真实失败率仍有 50%，连续 4 次不复现的概率约 6%，并不算小。上一次我就是凭一次不复现写下"不是系统性缺陷"，随后就在 4 次里复现 2 次；这里不重复那个错误。

另有两点没被这四次覆盖：

- **编号与名称不一致的拒绝路径没有在 E2E 中被触发**，因为四次里模型都没有产生不一致的配对。它只有单元测试覆盖。
- 第 3 次走的是歧义反问分支，没有走到填写，所以它验证的不是填写正确性。

因此工时业务基线的状态记为：**结构与回执已收口，正确性证据转正但样本不足**；需要更多次回放、以及覆盖"先反问再填写""跨页后填写""用户中途纠正项目"等场景后才谈得上通过。

#### 追加四次回放（2026-09-12，覆盖评审点名的场景）

第二批不重复第一批，专门补评审要求但前四次没覆盖的情形。同样只填写、不保存不提交。

| # | 场景 | 请求 | 页面实际结果 | 判定 |
| --- | --- | --- | --- | --- |
| 5 | **先反问再填写** | Regression Project（5 个同名），反问后答"用列表里的第一个" | 2 条，`90abc38a…`（确为列表首个），10-12~10-13，每天 6h | 通过 |
| 6 | **用户中途纠正项目** | 先填装配产线自动化技改，再说"项目填错了，改成 JC-900 量产导入，其他不变" | 3 条切换为 `7ef94480…`，日期与工时保持 10-19~10-21、8h 不变 | 通过 |
| 7 | **跨页后填写** | 先停在库存流水页，再要求填 11-02~11-04 装配产线自动化技改，每天 5h | 模型自行导航到工时页并填写，`577eaa44…`，5h | 通过 |
| 8 | 常规重复 | JC-900 量产导入，11-09~11-11，每天 4h | 3 条 `7ef94480…`，合计 12h，复述与页面逐项一致 | 通过 |

两处计划外但正确的行为：第 6 次首轮，模型发现表单里已有**另一个期间**的未保存内容，先反问是"替换"还是"另开一张"，没有直接覆盖用户未保存的工作；第 5 次反问时把 5 个同名项目的 id 都列了出来，而不是含糊带过。

**八次累计。** 第 1–8 次里有 7 次走到填写（第 6 次含两次填写：初填与纠正），第 3 次按设计没有填写而是反问。**选错项目 0 次**（改动前是 4 次里 2 次）。

统计上这比第一批强得多：若真实失败率仍是 50%，连续八次不复现的概率约 0.4%；即便按 30% 算也只有约 6%。结合单元测试覆盖的拒绝路径，可以说**这条缺陷的证据已经转正**。

但仍有一处必须写明：**编号与名称不一致的拒绝路径在八次 E2E 中从未被触发**，因为模型一次都没有产生不一致的配对。它只有单元测试覆盖。这既可能说明解析确实正确了，也可能说明"必须同时报出名称"这个要求本身在促使模型更谨慎——两者无法从这八次里区分开。

据此把工时业务基线的状态从"证据不足"改为：**结构、回执与正确性证据均已就位，拒绝路径仅有单元覆盖**。

### 已修：补丁守卫改为检查执行中的产物（评审 §5b）

评审说得对，原守卫证明不了任何有用的东西。

**原来的漏洞。** `check-dsh-patch.mjs` 在 `@deepseek-ai/dsh-typert-generator` 的 **`src/analyzer.ts`** 里 grep 一句注释。但生成器是从 **`lib/index.js`** 执行的（包的 `main`）。于是"改了源码、忘了重建 DSH"这个最容易发生的状态下，守卫通过，而真正运行的生成器没有修复。而且那句标记是注释，**打包时会被剥掉**，所以它根本不可能在产物里被检出——原方案在设计上就够不到要检查的东西。

**改法，三层，职责分开：**

1. **执行中的产物必须带修复（硬失败）。** 用 `require.resolve('@deepseek-ai/dsh-typert-generator')` 拿到 Node 真正加载的入口，在里面找补丁**发出的代码**而不是注释：`resolveModuleName("@deepseek-ai/dsh-typert-protocol"`。这是充要条件——产物带修复，生成就正确。
2. **补丁文件是否仍与 DSH 树逐字对应（警告）。** `git apply --check --reverse` 精确回答"这个补丁此刻是否正好处于已应用状态"。这是维护信号而非构建阻断：产物那层已经决定了能否正确生成。
3. **版本基线（警告）。** 新增 `patches/deepseek-harness-external-remote.json` 固定 `0.1.5-rc.2` / `c291e7961a`，DSH 版本与之不符时提示重新导出补丁。

**生成产物断言。** `generate-dsh-remote.mjs` 现在在**写盘之前**断言描述符里同时存在普通 Remote（`=> Promise<RemoteResult<…>>`）与流式 Remote（`=> AsyncIterable<…>`），两者在分析器里走不同路径。断言失败则不写，旧产物保持不变。

**守卫做了证伪，两个方向都验过：**

- 把产物里那句 `resolveModuleName("@deepseek-ai/dsh-typert-protocol"` 改掉（模拟"源码已打补丁、DSH 未重建"）→ 守卫**退出码 1**，并给出"必须重建 DSH"的修复指引。**这正是旧守卫会放过的情形。**
- 把补丁从源码里 revert、产物保持已打补丁 → 守卫**退出码 0 + 警告**。**这正是旧守卫会误报失败的情形**（生成其实能正常工作）。

两次都用 finally 还原，并比对 sha256 确认产物逐字复原。所以新守卫在两个方向上都比旧的准确。

**一个被证伪推翻的认知。** 旧注释（以及我写新注释时的假设）说"缺补丁时生成器不报错、只是静默跳过被装饰的方法"。实测不是：拿掉补丁后生成器会抛 `typert(host): @oryh/dsh-host publishes Remote artifacts but has no Remote methods`。原因是本包在 `package.json` 的 `files` 里列了 `lib/typert.remote-client.*`，触发了上游自己的检查。所以那层保护**是真的，但是借来的**，而且取决于我们自己的 manifest——把那两行从 `files` 去掉，静默跳过就回来了。两处注释已按实测改正，断言保留为不依赖该条件的正向检查。

**干净构建验收。** README 的启动顺序补上了缺失的补丁步骤，并写明第 2、3 步不能省、以及生成器从产物运行因此"只改源码不重建等于没打补丁"。实际执行了：删掉全部 12 个包的 `lib/`（`.gitignore` 里就是构建产物）后从零 `pnpm run build`，12 个包全部重建，守卫与描述符断言通过，重建后的描述符含 2 个流式、86 个普通 Remote；`pnpm run profile:install` 解析成功；`pnpm run verify` 201 项通过。补丁可应用于**未打补丁的树**这一点，由上面第二个证伪实验顺带证明（revert 后能原样 re-apply）。

**未做：** 没有从 pristine `git clone` ＋ 全新 `pnpm install` 跑过两个仓库的完整冷启动。上面验证的是"清空构建产物后可重建"，不是"全新克隆可复现"，两者不等价——依赖解析层面的问题这次测不到。
