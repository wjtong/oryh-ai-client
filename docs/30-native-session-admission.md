# 原生浏览器会话入口的服务器接入

状态：入口审计与工作区能力校验完成，浏览器链路未开放。

## 当前入口实际怎样运行

已检查 Harness 的公开 `@deepseek-ai/dsh-session-controller`、`@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-workspace` 与 Connection/Gateway 包：

- SessionController 的 create/prompt/resume/fork 路径通过 AgentRegistry 创建或恢复 Agent，setup 来自其 composeAgent。当前没有调用 ORYH 的 `oryhServerAgents.start()`。
- composeAgent 可以装入原生 Agent preset。preset 使用共享的 standing scope，mount 将 Agent 加入该作用域；不能把这个共享实例当成每一次浏览器请求的身份容器。
- SessionController 的公开 Config 当前只有 nativeOpen，没有统一的 workspace/session admission 回调。它的 Session 查询、流、附件、模型选择、队列与取消也都是入口，不能只保护 create。
- WorkspaceRegistry.create 接受存在的路径并规范化。服务器需要先限制为已分配目录，不能仅隐藏前端的目录选择器。
- Connection 提供公开 RPC 拦截、Fetch 和请求认证边界；Gateway 自身注册 /api 和流通道。后续应优先在这些公开边界绑定可信授权，而非重写原生协议或导入私有实现。

因此，当前不能直接把桌面 SessionController 加入服务器 bundle，然后把“浏览器已经登录”等同于“原生会话已受 owner 限制”。这不意味着 Harness 不支持服务器部署，而是现有 ORYH 工厂还没有与这些入口连通。

## 本批已经实现的边界

`allocateOwnerWorkspace` 在可信私有数据根下按 owner hash 分配 workspace。它签发不可序列化的进程内能力，Agent 工厂必须通过 `requireOwnerWorkspace` 检查该能力与 OAuth grant.owner 一致，才能向原生 Session 传入 cwd。

复制的对象、JSON 恢复的对象、其他 owner 的能力均被拒绝。分配和使用时检查目录类型、访问权限、文件所属 UID 与符号链接；使用前重新检查实际路径。服务器不再通过任意绝对字符串创建 Agent 工作区。

能力只在本进程有效，重启后须依据服务器记录重新签发，不能把其 JSON 当成恢复凭据。它还不是原生 Workspace ID，也不替代 owner 数据根的可信分配、持久化索引和进程隔离。同 UID 恶意进程的文件系统竞态仍需容器/系统隔离解决。

## 接下来要完成的连接

1. 在登录域到 owner 域转接时签发一次性凭据，兑换后固定浏览器会话、runtime generation、owner 与 grant。禁止从浏览器报文读取可信 owner 或采用宽域 Cookie。
2. 为原生 SessionController/Workspace/附件/流入口建立统一请求鉴权。先验证公开 Connection 边界能否携带请求作用域到全部异步调用；不能跨请求共享可变的“当前用户”。如果现有公开协议无法覆盖，需要向 Harness 增加明确的服务端 admission 扩展，而不是包装其私有方法。
3. 通过公开 Agent preset 或受支持的 setup 扩展把只读工具组合接入原生 create/resume/fork。保存的 cwd、preset 和父会话都须重新校验，模型选择也只能来自该用户允许的配置。
4. 原生列表/搜索/历史/附件/流应使用同一归属判定。测试不能只验证错误 ID 返回失败，还要验证同 owner 不同浏览器授权退出互不影响、generation 失效、流中注销与恢复后的访问。
5. 以上边界通过后，才在实验服务器 bundle 加入原生会话 UI/Remote；最后验证真实 HTTPS Cookie、完整 Gateway 和实际浏览器行为。

这些步骤继续复用 Harness 的会话、Composer、Gateway 与存储，不建立另一套聊天应用框架。当前 Profile 中未开放原生浏览器会话入口，也没有新增替代聊天 HTTP 路由。


## 2026-09-14 公开 Gateway 接入验证

外部 `ServerGateway` 继承公开 `@deepseek-ai/dsh-api-gateway`，覆盖公开 `invoke` / `stream` 方法，在调用原生实现之前执行 `oryhGatewayAdmission`。真实 Connection HTTP RPC 和 Gateway WebSocket mux 测试均验证拒绝生效，未导入 Harness 私有路径或修改其协议。

`nativeAdmission` 固定创建请求的 Workspace/preset，并拒绝浏览器自选 Session ID、其他路径及未开放的命名空间。普通命令、排序锚点及 page/follow 内嵌的 session/subagent 地址都校验持久化 cwd 与固定服务器 preset，防止恢复旧桌面 preset。授权终止信号传入原生方法和流。

限制：该策略尚未加入部署 Profile；物理存储必须已经按 owner 隔离。列表/搜索/全局 control/follow 的隔离依赖此条件。原生 `$events`、事件结果回传和附件 Fetch 路由不经过上述两个覆盖方法，仍须通过外部认证代理的同 owner/generation/lifetime 约束并单独验收。该测试不能证明所有原生入口已保护，也不能替代登录域转接、preset 业务能力组合及真实业务写入验收。


## 2026-09-15 原生会话组合进展

已新增外部 native-binding/native-preset，复用公共 SessionController 的 preset 装载路径，固定 Workspace 与服务器 preset。实际 HTTP 创建和发送消息已在原生服务栈中执行查询工具并得到模型回复，包含越权与撤销拒绝测试。只读能力不再仅能通过 ORYH 自己的 Agent 工厂启动。

这仍是可测试组件组合，尚未作为对外部署 Profile 发布。共享 owner 的多浏览器授权池、OAuth 回调到 owner 路由、原生特殊通道及业务写入确认仍按前文要求继续验收。
