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

**外部插件只能引用 Harness 的类型，不能引用它的值。** 最初直接 `import { RemoteSnapshotStream, RemoteStreamCarrierError }`，四个工程 `tsc` 全部通过，但 esbuild 警告 `Import "RemoteSnapshotStream" will always be undefined because .../gateway/lib/client.js has no exports`。原因是 DSH 客户端包以 `window.__ModuleLoader__.load({id, factory})` 分发，不是 ESM 模块；`build-dsh-client.mjs` 只把 react、cordis、dsh-client-store 列为 external，其余全部打包，于是值引用在运行时是 undefined，`new RemoteSnapshotStream(...)` 会直接抛错。类型检查发现不了这一类问题，只有 esbuild 警告会提示。已全仓审计：客户端源码其余非类型的 `@deepseek-ai` 引用只有 `dsh-client-store`（在 external 名单内）与 layout.spec 的两个（spec 不进 bundle），没有同类隐患。这一条与"转发事件是封闭白名单"、"自定义 SessionEventMap 会破坏会话重载"属于同一类外部插件边界。

代价：`ctx.remote.$stream` 是服务方法可以照常使用，但 `RemoteStreamCarrierError` 是类、拿不到，没有它就无法把"正常结束"标记为可重试。因此重连循环自行实现，固定 1 秒重开，放弃了 DSH 依 Connection generation 调度重试的节奏。若该类将来可达，应换回官方实现。

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

**页面标识的散落情况（实测）。** 四张互不相同的页面表：`OPERATIONS`（core/operations.ts，3 页，title/description/method/path）、`layout.tsx:87` 的 pages 数组（9 页加 settings，id/文案 key/图标）、`workbench.tsx:46` 的 pages 记录（3 页，title/description/icon）、`business-chat.ts:106` 的 names 映射（10 页，id→中文名，旁边另有 capabilities 三元表达式）。六处字面量 id 列表：`AccessPage`、`app.tsx:46`、`oryh_navigate` 工具的 enum、`ChatPageRequest['page']`、`saved-operations.ts:218`、`BusinessView`。七处以上 switch：`controller.ts` 四处、`OperationExecutor` 一处、`business-chat.ts` 的 pageSync 命令→页面三元与 pageData 分发。其中 `core/remote.ts` 的两个 switch 每个 case 主体完全相同，属于纯噪音，无论采用哪种方案都应删除。

**第 2 步：抽出 `@oryh/dsh-connections` 与 `@oryh/dsh-workbench`，引入页面登记表。** 一条记录描述一个页面：id、文案 key、图标、访问规则（identity → boolean）、可选的确定性操作（method/path/decoder）、Host 侧能力与提示语、客户端组件。`canAccessPage` 的 switch 变成遍历登记表。

放置位置需要先定：登记表必须同时被 core（access/operations）、dsh-host（工具 enum、capabilities）与 web（侧边栏、workbench、app）引用，因此只能落在三者共同的底层——core 内的新模块，或一个新的最小包。另需注意 Host 那半不只是命名问题：`bindingPage`/`assertPage`/`assertSelectionPage` 是从绑定状态反推页面 id，登记表必须暴露对应的推导钩子，否则只收敛了客户端，Host 的散落原样保留。

退出条件：`canAccessPage` 的 switch 消失；`app.tsx:46` 与 `layout.tsx` 的 pages 数组由登记表生成；`oryh_navigate` 的 enum 由登记表生成；`core/remote.ts` 两个恒等 switch 删除；`pnpm run verify` 全绿；两条 E2E 基线回放与上一节一致。

**第 3 步：records 试点。** 先迁 `sales-orders`、`inventory-items`、`inventory-item-details`、`shipments` 四个只读列表，用真实业务域验证登记表的形状。只读页面出错代价最小，适合作为第一块。

**第 4 步：timesheets。** 工时是唯一同时涉及导航命令、表单建议、审批队列和回执等待的域，是登记表最强的压力测试。

**第 5 步：projects、todos、expenses，并删除旧包。** 全部迁完再删，避免中途出现两套并存的事实来源。

**第 6 步（可选）：agent preset。** 把工具白名单与提示词收进 preset。

每一步都以 `pnpm run verify` 全绿加两条 E2E 基线回放作为退出条件；基线不一致时必须先解释差异来源，再决定是否属于回归（如第 1 步中产品编码位置的差异，经轨迹确认来自模型选择而非通道）。
