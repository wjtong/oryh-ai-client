# ADR-0011：服务器版可信 Harness Host 与隔离脚本执行

日期：2026-09-14。状态：P0 原型方向已选定；生产组合、真实用户确认和全部执行入口审计待验证。

关联：[服务器方案](../19-multi-tenant-server-plan.md)、[P0 实施记录](../27-server-p0-implementation.md)、[ADR-0010](0010-agent-is-the-primary-client.md)。不改变桌面版已接受的 Agent 主客户端行为。

## 原因

如果整个 Harness Host 与租户 Bash 都在不可信执行区域，外部代理不能仅凭 Host 回传 `allowed-once` 就认定真实用户确认。Host 还拥有原生页面、Session、Remote 和审批呈现；让租户代码能修改这些内容会破坏确认链路。

源码及实测表明，公开 `@deepseek-ai/dsh-shell` 定义了可替换的 ShellExecutor，`@deepseek-ai/dsh-bash-local` 公开提供 `runArgv`/`startArgv` 扩展机制，原生工具与 Composer 无需复制。公开 WebServer、Connection、Gateway 也能经 owner 路由代理工作。

## P0 决策

每 owner 保留一个可信 Harness Host（及其私有 Session/HOME），将租户脚本放入独立执行容器。Host 不挂入脚本容器；脚本侧仅获得分配的 Workspace 和经过校验的只读技能版本。控制服务、凭据服务和业务代理仍在执行区域之外。

`skill`、`bash` 与原生会话继续由 Harness 组合提供。Host 使用外部 Shell provider 委托执行；脚本不能接触 Host 的插件、Profile、会话存储、内部认证和控制接口。服务器 Profile 还必须封闭其他可能启动代码的入口：子进程、Hooks、MCP、LSP、代码运行器、插件安装，以及任意 Host 文件访问。只替换 Bash 不等于所有执行路径已安全。

可信 Host 可以接收原生 approval 的用户决定，再通过仅供可信服务的授权接口将决定绑定到实际请求摘要。模型工具不能调用批准接口。代理不接受脚本提供的身份、Session、批准结果或摘要作为可信证明。真实浏览器响应、owner/Session/请求绑定及撤权仍是 S0-5 的必测项，当前原型没有完成这一链路。

## 已取得的证据

- 两个真实 Cordis 组合加载公开 WebServer、Connection、FrontendStatic、Typert Registry 和 Gateway。通过 owner 子域代理读取实际已构建的原生 HTML/JS，调用 Connection 测试路由，并建立真实 `/api/remote.mux` WebSocket；代理只传输字节，不解析 mux。
- 代理验证 owner、Cookie 租约、Origin 和目标，内部启动 token/Cookie 不下发浏览器；撤销租约关闭流和 WebSocket。
- 外部 provider 继承公开 LocalBashExecutor，在真实 Cordis/Subprocess 下运行 Docker 前台命令：Workspace 写入、退出码、stdin、超时、取消均验证；执行容器没有 Host 文件或 Docker socket。

这些证据不等于已通过完整 Profile、浏览器 UI、模型或业务审批联调。

## 明确限制与后续

当前前台执行原型每次创建独立容器；不提供后台任务、托管环境变量映射或权限预设语义。它们目前显式拒绝，不能在实际服务器 Profile 中偷偷降级。后续根据公开 Shell/Jobs 生命周期决定复用每 owner 容器还是每任务容器，并验证完整任务树、孤儿恢复及 generation。

原型先选择子域路径保留原生根 URL。路径前缀尚未做对照验证，生产选型还需真实浏览器、boot manifest、插件 bundle、TLS、域名/Cookie 和附件源测试。当前 loopback 代理的内存登录租约由测试代码签发，不是 OAuth 登录服务。

2026-09-14 复核：ORYH 已有 OAuth/MCP 无凭据技能交付，服务器业务优先用 MCP，无需为普通业务启动 Bash。隔离 Shell 作为需要脚本时的能力保留；无凭据 ZIP 不再是外部阻塞。Harness 的 prompts/resources 消费、OAuth 生命周期、真实委托联调、服务端幂等和资源事件仍需逐项验证。P0 全部通过之前仍禁止启用生产多用户组合。
