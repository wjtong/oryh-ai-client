# 多租户服务器版：P0 实施记录

日期：2026-09-14。分支：`codex/multi-tenant-server`。Client 起点 `48748eb`，Harness 参考 `c291e7961a` 加仓库已有 Remote 补丁。

## 状态

已开始实现 P0 验证工具，**尚未通过 P0，未进入 P1，不能作为多用户服务器部署**。桌面 Profile 与 `developmentOnly` 限制保持不变；本轮没有连接测试企业执行写入，也没有读取/迁移现有用户凭据。

方案和验收以 [docs/19](19-multi-tenant-server-plan.md)、[docs/21](21-s0-acceptance.md) 为准。原先未提交的这两份修订已随工作区保留在新分支上。

## 已实现

独立私有包 [server-lab](../packages/server-lab/README.md)，不加入 DSH Profile，不提供业务网页或第二套 Chat：

- `LabBroker`：可信 owner/generation 绑定、拒绝伪造 channel、过期/撤权拒绝、固定 action 列表、请求摘要与测试确认绑定。
- 每身份 Unix socket：只接收执行请求，拒绝身份字段/认证头/目标 URL，不提供确认、凭据读取、核对或管理接口。
- 写入回执原型：并发和完成后的同操作去重；响应丢失保持结果待核对；可信测试端核对后读取成功回执，不重发。读取不会复用旧查询结果。
- 技能快照原型：校验路径、身份和完整内容 hash，发布前复制输入，原子切换当前版本，运行任务可保留旧完整版本。取消/安装失败不删除旧快照。
- Docker 探针：四个独立执行容器与外部测试 broker，各自只挂载一个身份 socket，禁网络、禁 capabilities、只读根和代码、非 root、资源上限；全部资源带随机前缀并清理。
- 构建清单与干净克隆脚本：记录实际 Remote 描述符和依赖/补丁 hash，替代历史固定接口数量断言。

这些代码验证基础机制，不是已完成的生产控制服务。授权、回执和租约仅在内存；技能快照不提供跨进程同步/断电持久性；实际 ORYH 请求、Session 绑定、可信浏览器批准及完整 Harness Profile 尚未接入；第二批已加入真实原生传输与公开 Shell provider 的局部组合验证。

## 本轮验证

- 修改前及本轮新增后的完整 `pnpm verify` 均通过；本轮合计 279 项测试，其中新增实验包 20 项。
- `server-lab` 自动测试覆盖身份冒用、确认载荷变更/过期/跨身份、重复写入、响应丢失、撤权、旧 generation、socket 越权、技能快照更新及失败恢复。
- Docker 实测四身份 A1/A2/B1/B3：各自 socket 可查询，伪造身份/管理请求/未确认写入被拒；没有测试 key 出现在执行侧环境或返回值；其他身份卷和宿主敏感路径未挂载；执行侧无网络接口、非 root、无有效 capabilities、不可改探针代码。
- 在 broker 可信进程推进 A1 generation、撤销 A2 后，原执行容器继续请求均被拒绝。此处没有模拟真实 Shell 进程树排空。
- 使用本机已有 `node:24-bookworm-slim`，实际镜像 ID 为 `sha256:9be410e06dadc1794f44aa4c0fd107a7ecb2edb5cb6bcc6a71c7888caf3cfa12`；没有拉取新镜像或接触现有 ORYH 容器。

### 干净克隆构建结果

在新的临时目录克隆已提交的 Client `48748eb` 与 Harness `c291e7961a`，执行 frozen 安装、应用已提交补丁、完整 Harness 构建和 Client verify，全部通过。再次生成 Remote 声明内容完全一致，且与当前工作区构建的声明 hash 一致：`d6e15a529ab117c5a87b7e77c1e5667ce9f40783035258fdf63a2794b5b609e1`。

此验证没有包含未提交的 server-lab；新代码由当前工作区的完整 verify 另行覆盖。它仍可能使用宿主包缓存与构建环境，不等于无缓存或可复现镜像证明；没有安装 Profile 或启动业务浏览器。README 的补丁命令已改为绝对补丁路径，避免 `git -C` 后从 Harness 目录错误寻找补丁。

脱敏汇总与实际接口清单：[P0 验证证据](evidence/server-p0-2026-09-14.json)。原始构建日志留在本轮工具输出所示临时工作区，未纳入源码。实验 Docker 容器与卷均已清理；原始构建工作区保留供排查。

## 尚未通过的门槛与具体下一步

| Gate | 当前证据 | 下一步 / 责任范围 |
| --- | --- | --- |
| S0-0 构建/公开组合 | 本机 verify 与生成契约可用；49 个当前 ORYH Remote 描述符（48 普通、1 流式）。干净克隆和重复生成已通过 | Client：固定可重现构建，重复产物比较，实际 Profile 生命周期及浏览器组合 |
| S0-1 原生代理 | 真实原生前端资源、Connection、Gateway WebSocket 的子域代理通过；完整 Profile/浏览器仍待验证 | Client/Harness：隔离测试 Profile，前缀/子域代理、Cookie/流/下载和活跃附件 |
| S0-2 隔离/生命周期 | 四容器底层探针、真实 Shell provider 前台执行，以及 owner 池/原生最小 Host 生命周期通过（分别验证，尚未整合成完整隔离 Profile） | Client/运维：装入真实 Harness，任务进程树、负载、资源耗尽及持久目录验证 |
| S0-3 OAuth/技能 | 复核 main：OAuth/MCP 已支持无凭据 prompts/resources；撤回 ZIP API 为前置阻塞的判断 | Client：Harness 技能读取与 OAuth 集成；部署版本、逐操作权限与撤权联调 |
| S0-4 凭据 | 合成 key 不暴露的 socket 边界探针通过 | ORYH/Client：真实 MCP 技能与受控业务/模型连接、完整文件/进程/模型/Session 泄漏测试 |
| S0-5 确认/恢复/同步 | 测试授权、回执和原子快照局部通过 | Client/Harness：真实用户可信确认；ORYH：幂等/核对协议及事件；跨用户页面验证 |

### Harness 公开扩展点的确认边界

已读取 `@deepseek-ai/dsh-user-approval`、`@deepseek-ai/dsh-client-ui-approval` 和 `@deepseek-ai/dsh-shell` 的公开服务契约。原生 approval 通过作用域 Remote Event 返回一次决定，ShellExecutor 支持外部 provider；不存在必须自写 Composer 的理由。

但是，`approval.request()` 的结果在 Harness Host 进程中返回。如果把整个 Host 与 Bash 都放进可被脚本控制的执行信任域，仅收到 Host 自报的 `allowed-once` 不能证明真实用户批准。测试 fixture 的 `approve()` 不能冒充此链路已验证。

第二批已通过公开 Shell provider 证明前台命令可离开 Host 执行，P0 采用“可信 Host + 隔离脚本执行”方向，见 [ADR-0011](adr/0011-server-trusted-host-and-isolated-shell.md)。真实原生 approval 到外部授权记录仍须验证不可伪造及 Session/请求绑定；不解析私有 mux，也不把通用命令放行当成业务同意。

## 运行入口

```sh
pnpm server:p0
pnpm server:p0:inventory
pnpm server:p0:cold-build
```

Docker 探针是显式执行项；普通测试不启动 Docker。每次运行都输出限制和未验证项，避免把局部通过当作多租户方案完成。


## 第二批：真实 Harness 传输与 Shell 接入

同分支继续推进；未提交或部署，原有客户端 Profile 不受实验包影响。

新增 `browser-proxy.ts`：仅 loopback 的 owner 子域认证代理，使用可信测试代码签发内存租约；内部原生认证 Cookie 留在代理，不下发浏览器。校验 Host/owner/Origin，剥离身份和转发头，拒绝启动 token 路径；HTTP 流和 WebSocket 在撤销/到期后关闭。

6 项新增测试实际加载公开 Cordis、WebServer、Connection、FrontendStatic、Typert Registry 和 Gateway，读取原生构建的 HTML/JS；通过 Connection 测试路由验证两个身份的数据归属、下载和流；通过真正的 `/api/remote.mux` 验证握手、ping/pong、重连和撤销。代理不解码内部协议。

这仍不是完整浏览器验收：测试路由的业务数据是合成的，没有加载全部 Profile/boot manifest/插件页面，没有实际模型流或领域 Remote 调用，也没有验证浏览器内活跃附件执行。路径前缀对照、生产 TLS/DNS/Cookie 策略仍待做。

新增 `container-shell.ts`：继承公开 `LocalBashExecutor`，保留官方输出、期限和本地子进程机制，将命令变为先创建、后附加的独立容器任务。先等待容器创建完成，再检查取消并启动，正常退出/超时/取消后移除该任务容器。Workspace 经 realpath 限定，Host 文件和 Docker socket 不挂入。

`pnpm server:p0:shell` 已实测：Workspace 写入、子目录、退出码、stdin、工作区外路径拒绝、环境变量转发拒绝、含子进程的超时、运行中取消、启动前已取消，以及相关容器确实清理。使用与首批相同的固定本地镜像；全部测试目录和任务容器已删除。

前台 provider 不支持托管 DSH 环境及每次调用的 sandbox policy，明确拒绝；`start()` 后台任务明确返回不支持。创建容器阶段有独立的基础设施超时，foreground timeout 作用于附加执行阶段。守护进程失联、Host 崩溃和孤儿恢复尚未实现，不能作为生产生命周期保证。

本批完整 `pnpm verify` 通过：合计 **285 项测试**，其中 server-lab **26 项**。随后对取消/清理检查的小修正重新构建并通过真实 Shell Docker 探针。汇总见 [第二批证据](evidence/server-p0-native-2026-09-14.json)。下一步是完整 Profile 和浏览器组合、原生可信确认、后台/环境/文件执行世界一致性，再联合 ORYH 完成无凭据技能契约。

## MCP 主路径复核（2026-09-14）

ORYH main 已区分 bundle/MCP 交付，服务器业务采用 MCP，无需先改造 ZIP API。此前的 ZIP 源码观察仍成立，但将其作为唯一服务器入口的结论已撤回。现有隔离、代理和快照实验仅证明各自边界；快照实验不是 MCP 接入已完成的证据。详见 [MCP 接入复核](28-server-mcp-skills-review.md)。

## 第三批：MCP 远程技能 Provider

新增 `server-lab/src/mcp-skills.ts` 与 `mcp-reader.ts`。使用公开 `@deepseek-ai/dsh-skill` 的 `registerProvider` 将 MCP prompts 接到原生技能目录，使用公开工具注册 `oryh_skill_reference` 按授权目录读取参考 Markdown。没有复制原生 skill 工具、会话或 Composer，也没有修改桌面 Profile。

可信连接使用 MCP SDK Streamable HTTP；端点由 Host 固定，认证回调每次请求重新取值，可供后续 Vault/刷新服务接入。返回给 Provider 的窄接口只有 prompts/resources 四类读取，没有业务写入、原始 client 或凭据访问。禁止重定向、URL 内凭据和任意路径，调用取消与连接撤销贯穿读取；远端错误以固定提示返回，不复制可能含秘密的诊断。

Provider 的 locator 仅在当前实例有效；读取正文时重新请求 ORYH，不用缓存正文冒充当前授权。刷新方法供可信任务边界调用；插件卸载注销目录和工具，并阻止旧 Provider 调用。模型只提供 skill/path，不能提供 owner、tenant、认证头或 URL。审计钩子只记录资源引用、hash 和读取时间，不记录正文或 token。

新增 10 项测试使用真实 MCP SDK、loopback HTTP fixture、真实 Cordis SkillRegistry/Tools/SystemPrompt 和插件卸载；覆盖双身份隔离、内容更新、服务端拒绝、路径/资源限制、外来 locator、撤销、分页循环、重定向及不合法 prompt。服务器实验包共 36 项通过。

边界：HTTP 服务仍是测试 fixture，未验证真实 ORYH OAuth；未开放 MCP tools/call。刷新方法尚未挂入产品 Agent 的任务生命周期，连接关闭由可信宿主负责。512 KB 是读取后内容上限，不是流式网络字节配额；恶意服务器超大响应、生产 TLS/端点管理、令牌刷新锁、身份数据库和模型上下文泄漏测试仍需完成。禁止将本次结果称为多用户上线就绪。

下一步：OAuth 登录事务与可信 owner 绑定；原生 MCP tools 接入可信确认/回执边界；真实 Profile 中的技能刷新和页面同步。现有隔离 Shell 原型按需保留。

第三批完成后运行全仓 `pnpm verify`：构建、类型检查及 **295 项测试通过**。本轮没有重跑 Docker 探针，因为没有修改容器执行或代理边界；没有更新已保存的历史探针证据为新结果。

## 第四批：OAuth 登录事务与 MCP 凭据生命周期

新增 `server-lab/src/oauth.ts`，通过公开 Harness CredentialProvider 的记录接口保存 grant，复用 ORYH core 的 `decodeIdentity` 解析身份。服务器业务登录采用当前 ORYH 源码契约：URL client_id、固定同源 HTTPS callback、S256 PKCE、`resource=<issuer>/mcp`、表单编码 token 请求和 `/api/v1/auth/me`。不假设 OIDC/JWT、动态客户端注册、scope 或 tenant 枚举能力。

登录 state 与可信入口提供的随机浏览器绑定关联，10 分钟失效、最多 1000 个待完成事务；回调在第一次异步操作前消费，避免并发兑换。身份完全由 `/auth/me` 决定；owner 是 issuer/tenantId/userId 元组的 hash，拒绝空身份。Grant 是当前协调器拥有的不可变对象，序列化副本或其他实例的对象不能获得凭据。

`connectSkills(grant)` 固定连接到该授权 issuer 的 `/mcp`，调用方不能另传目标。MCP 每次请求通过可信回调取 token。临近到期的并发请求合并为一次刷新；刷新后重新核对 owner，身份漂移即拒绝。刷新与注销共享顺序写入边界，注销先中止请求并禁止后续使用，再删除凭据，迟到的刷新不能恢复 grant。刷新结果不明时要求重新登录，不盲目重试可能已消费的 refresh token。

新增 12 项测试覆盖 PKCE/回调/browser binding、重复/取消/超时授权、身份隔离与伪造句柄、20 请求并发刷新、刷新中注销、身份漂移、错误脱敏，以及 OAuth 凭据回调与真实 MCP SDK 的 HTTP 连接。服务器实验包 **48 项测试通过**。另在 calwbiz 的内存 SQLite 测试环境运行 `tests/test_oauth.py`：**5 项通过**（一条依赖弃用警告）。两组测试不是部署 OAuth 的浏览器端到端证据。

### 尚未接入的产品边界

- 当前是协调器，不是已上线的登录页面/HTTP route。可信入口还需签发和轮换 HttpOnly/Secure/SameSite Cookie、验证重复 callback 参数、建立浏览器登录会话与 runtime 租约。客户端 metadata URL 的发布、真实 HTTPS 回调和 Profile 需联调。
- 待授权事务、句柄与刷新锁为单进程状态。CredentialProvider 复用了公开存储接口，但尚未实现服务器加密存储、跨进程 CAS/租约、重启恢复与孤立 grant 清理；不能按多副本部署。
- ORYH metadata 没有 revocation_endpoint；当前 revoke 是本客户端断开与本地凭据删除，不能称为 ORYH 远端 token 撤销。若要求退出时立即撤销整条服务端授权链，需确认现有正式业务接口是否满足，或约定额外撤销接口。
- 登录返回的角色/权限仅为当时快照，不能用作永久授权缓存；业务仍以 ORYH 每次调用鉴权为准。多企业需分别授权并核实各自身份，尚无 membership 列表证明。
- 本轮未接真实用户凭据、未调用真实业务写入，未开启 MCP 通用写入工具或正式服务器 Profile。

第四批全仓 `pnpm verify` 完成：构建、类型检查及 **307 项测试通过**。未修改容器执行边界，本轮未重复 Docker 探针。

## 第五批：原生 WebServer 登录路由与浏览器会话

新增 `server-lab/src/login-routes.ts`。通过公开 `@deepseek-ai/dsh-host-webserver` 的命名路由注册能力安装 login、callback、session、logout 与 client metadata 路由，卸载随 Cordis 生命周期清理。没有新建应用壳、HTML 聊天页面或独立产品 HTTP 服务。

浏览器预登录绑定和正式会话使用不同的 `__Host-` Cookie，均为 Secure、HttpOnly、SameSite=Lax、Path=/，不设置 Domain。登录成功轮换随机会话值，服务端仅按 hash 查找会话；响应只含身份/owner/generation，不含 OAuth 凭据、内部 Harness cookie 或运行环境管理句柄。固定 HTTPS origin 与 callback，不接受浏览器提供的 issuer、tenant、runtime 或重定向目标。

入口拒绝重复 callback 参数、重复 Cookie、跨站修改、错误 Host 和未约定的 forwarded 头。OAuth callback 允许授权服务器跨站导航，但必须有匹配的预登录 Cookie/state；并发重复 callback 不会取消第一个正在完成的登录。回调结果始终跳转到固定 `/`，避免继续携带授权码。全部路由响应 no-store/no-referrer。

运行环境由可信 `acquire(grant, signal)` 分配，必须返回匹配 owner 的正整数 generation 与可撤销租约。受保护路由通过同一 `authorize(req)` 获得绑定，不从请求参数解释运行环境身份。退出、TTL 到期、运行环境 signal 失效和插件卸载均先使会话不可用，再撤销本地 OAuth grant 并释放租约。退出发生在运行环境启动中时，迟到的启动结果也不能建立新会话。

新增 12 项测试使用真实 Cordis/WebServer 与 Node HTTP 请求，覆盖 Cookie/metadata、callback 注入与重放、并发 callback、跨站 logout、Host/重复 Cookie、重新登录轮换、运行环境失效、过期、启动失败/owner 不匹配、启动中 logout 和插件卸载。授权端与运行环境分配仍为隔离 fixture。

### 与产品集成的距离

- 路由已实测，但未启用生产 Profile；没有复用现有桌面启动 token 当作服务器登录。
- 当前测试以 loopback HTTP 承载固定 HTTPS Host，验证 Cookie 属性和路由策略，不代表浏览器已验证 TLS、反向代理或 Secure Cookie 的实际发送。部署代理须符合 Host 契约，不能默认信任 forwarded 头。
- `acquire` 尚未接实际 owner Host/容器池；真实 runtime 须遵守取消、幂等 release、generation 失效时中止旧 signal 的契约。多标签页/同 owner 多次登录的共享和计数仍需实现。
- `/` 是未来原生 Profile 的落点。当前登录控制域尚未与既有 owner 子域代理建立安全的一次性转接；不可把控制域 Cookie 扩展成宽 Domain Cookie。完整 Connection/Gateway/附件访问仍需验证。
- 预登录和浏览器会话仍为单进程内存，有容量与 TTL 上限。数据库恢复、多副本、运行环境清理失败监控和部署端登录限流仍待实现。

第五批全仓 `pnpm verify`：构建、类型检查及 **319 项测试通过**，其中服务器实验包 60 项。未改动原生字节代理或 Docker 执行代码，本轮未重复容器探针。

## 第六批：owner 运行环境池与真实 Harness Host

新增 `runtime-pool.ts`：同 owner 启动去重、独立浏览器租约、最后租约释放后的空闲回收、容量限制、取消、generation 更新、运行环境失效与关闭。20 个并发申请只创建一个运行环境；取消一个等待者不影响其他等待者。启动/清理期间的实例占用容量；清理完成前不会启动替代实例，清理失败保留为不可用状态并返回失败，不能假装已回收。

运行环境池仅接收可信 owner，不持有第一个登录用户的 OAuth grant。每个浏览器会话仍持有自己的授权与租约，退出一个会话不会撤销同 owner 其他会话的 OAuth。目标解析只接受池签发的原始租约对象，序列化副本、外来租约、已释放或旧 generation 均不能解析为可访问目标。

新增 `native-runtime.ts`，工厂实际创建独立 Cordis Context，加载公开 CredentialProvider、WebServer、Connection、Typert Registry、Gateway 和 FrontendStatic。每个实例有独立 loopback 端口和合成内存凭据记录；可信侧兑换内部 Connection cookie，浏览器只持有前述登录会话 cookie。测试读取真实构建的原生前端和公开 Connection 测试路由，不解析或复制私有 mux。

登录路由联调已使用该运行环境池及真实 Host：两个相同 owner 的独立登录共享运行环境，另一 tenant 使用另一实例；退出第一个登录后，其浏览器访问被拒绝，而其余两个仍可访问。测试中的受保护转发仅用于读取 `/api/p0-runtime`，不将内部凭据写入响应。

本批新增 12 项池测试和 1 项登录/实际 Host 集成测试。覆盖启动去重、取消、容量、引用释放、空闲回收、清理失败、崩溃失效、启动失败重试、新旧 generation、伪造租约，以及实际原生 HTTP/内部认证与关闭。服务器实验包 **73 项通过**。

### 尚未证明的边界

- 当前多个 Host 是同一测试进程内的独立 Cordis Context，不能作为操作系统进程/容器隔离的证明；仅挂载最小公开模块，不加载用户插件、模型或 Bash。
- `native-runtime` 的凭据服务是每实例合成内存实现，不访问用户环境或真实密钥；真实服务器必须替换为已隔离的受信凭据服务。
- Workspace/Session 持久化、实际多用户 Profile、owner 进程/容器工厂、崩溃检测、任务树与后台作业仍待集成。公开 workspaceRegistry 本身允许任意存在的绝对路径，产品入口必须限制到服务端分配目录，不能直接开放原生任意路径注册。
- 池容量满时明确拒绝，尚未实现公平排队；generation 和租约为单进程内存，没有跨进程 CAS 或恢复。工厂必须可取消并在启动失败时清理自身资源；不响应取消的工厂可能拖延关闭，仍需接实际进程监管与截止时间。
- 控制域到 owner 子域的一次性转接、真实浏览器 Cookie 行为和完整 Gateway 访问仍未通过；没有将控制域会话 Cookie 扩展成宽域 Cookie。

第六批全仓 `pnpm verify`：构建、类型检查及 **332 项测试通过**。原有容器/Shell 代码未变，本轮未重复 Docker 探针；真实最小 Host 的启动、服务和回收由本轮新增测试覆盖。

## 第七批：独立 Host 进程与原生 Workspace 持久化

新增 `process-runtime.ts` / `process-worker.ts`，运行环境池可启动固定的受信 Node 子进程。每 owner 使用不同 PID，进程从固定已构建入口启动，清空继承的 execArgv，环境仅包含必要 PATH、独立 HOME/DSH_HOME 和运行模式。OAuth 凭据不在环境或命令行中；内部 Harness cookie 仅从子进程经私有 IPC 返回父进程，stdout/stderr 不作为身份或错误协议。

持久目录按可信 owner hash 分配：`home`、`workspace`、`storage`、`sessions`。父目录及各目录要求私有权限，拒绝符号链接与非法 owner。原子创建 `.host-lock`，同一数据根第二个启动者直接拒绝。父进程确认子进程退出后才释放锁；启动失败或取消也清理已取得的锁。父进程失联时 worker 主动关闭；残留锁不根据猜测自动删除，须在确认无存活写入者后恢复。

原生 Host 新增可选持久目录配置，加载公开 `dsh-session`、`dsh-session-persistence-jsonl`、`dsh-storage`、`dsh-storage-json`、`dsh-storage-domain`、`dsh-workspace`。默认 Workspace 由 `workspaceRegistry.create` 创建/恢复，公开测试路由只返回其 ID、名称和创建时间；没有开放任意路径注册，没有自写 Workspace 数据表。测试命令现在先构建实验包，保证子进程运行当前编译产物。

进程停止先请求正常退出，5 秒后仍未结束则强制结束子进程；启动握手有 20 秒上限。退出事件使运行环境租约失效，池等待锁清理后才启动新 generation。

### 验证与边界

新增进程测试验证两个实际 PID、不同 owner 的 Workspace ID、正常重启保留原生 Workspace、重复监督者被锁拒绝、符号链接/非法 owner 拒绝、启动取消清理，以及 SIGKILL 后租约失效与原 Workspace 恢复。登录路由另有一次真实子进程 Host 联调，仍使用合成 OAuth 数据。

本批证明的是 Workspace 注册信息持久化；Session JSONL 后端已挂载，但尚未产生真实模型会话并验证对话历史恢复，不能以工作区恢复替代会话恢复。

独立进程使用相同操作系统 UID，不构成恶意代码之间的文件访问隔离。当前固定 Host 不加载租户 Bash、Hook 或任意插件；不应开放不受信执行能力。隔离 Shell/容器仍需与正式 Profile 整合。当前监督只管理固定 Host 子进程，未验证任意后代进程树、后台模型作业、跨机器锁或多副本状态恢复。

内部 IPC 结果尚未通过安全的控制域→owner 域转接交付给完整浏览器组合。完整 ORYH Profile、真实 OAuth/模型、跨域 Cookie 和 Gateway 业务操作的联调仍待完成。

第七批全仓 `pnpm verify` 完成：构建、类型检查及 **338 项测试通过**，其中服务器实验包 79 项。本轮不重复未变更的 Docker/Shell 探针；新增子进程由测试启动和清理，未操作既有 ORYH 服务。

## 第八批：Session 恢复与 Profile 组合审计

新增 `session-probe.ts`，仅在 P0 持久化 Host 中注册合成会话探针；按公开持久化句柄契约执行 create/append/flush/close。内容是明确标识的固定测试用户消息和助手回复，不调用模型，不接受任意聊天内容或业务写入。新增两项实际子进程测试：正常重启和 SIGKILL 后原生事件完整恢复；另一个 owner 的相同 Session ID 读取失败。服务器实验包共 81 项通过。

新增 `probes/profile-audit.mjs`，使用公开 app-boot 在临时 Profile 中解析 base/web-app/ORYH 三个 bundle。得到 156 个条目，0 条 patch 警告，未读用户 patch/.env，未激活完整组合。只保存脱敏 id/name/disabled，见 [配置审计](evidence/profile-source-audit-2026-09-14.json)。

完整 Profile 不能直接复用桌面配置：已列出凭据、执行入口、workspace 文件/目录、插件设置、Agent preset、ORYH Host 连接来源等需要适配的真实条目。后续依赖与验收见 [服务器 Profile 接入清单](29-server-profile-integration.md)。当前没有将最小 Host、存储探针或静态解析称为完整 Profile/真实模型对话已完成。

第八批全仓 `pnpm verify`：构建、类型检查及 **340 项测试通过**。没有真实模型/API 业务写入；Profile 审计和持久化 fixture 的范围如上。


## 第九批：现有业务 Host 的可信服务器只读接入

`@oryh/ai-client-core` 新增 `createServerReadHost`，由可信服务器代码注入固定 HTTPS ORYH origin、已验证 tenant/user、授权中止信号及请求回调。初始化仍通过 `/auth/me` 复核身份，随后复用原有 Controller、权限规则、类型化业务查询和结果缓存。桌面构造路径保持原样；服务器路径不读取本机 Keychain，不制造替代业务密钥，不恢复桌面连接。

只读试点只准许 GET `/auth/me`、`/projects`、`/todos`、`/expense-claims`；拒绝写入、任意路径、跨源地址、路径编码绕过、设备登录、ZIP 技能下载与 schema 下载。MCP skills 继续由现有只读 Provider 负责，不伪装成桌面 SkillBundleService。授权中止会撤销连接验证、清除结果缓存并中止请求；即使上游晚返回，结果也不能再次交付。

实验包 `ServerOAuth.createReadHost(grant)` 接上该接口。Bearer 仅由可信请求回调获取，复用凭据服务、刷新互斥及身份复核；每次业务请求使用当前 token。新测试覆盖原 Controller 查询、身份不匹配、外来连接、路径/写入拒绝、中途注销、缓存失效和诊断脱敏；OAuth 集成测试覆盖真实 core Host 的查询、刷新后 token 轮换及注销后的请求拒绝。使用合成身份与内存 HTTP fixture，未连接真实 ORYH 或模型。

### 本批边界与后续

这是核心业务 Host 的接入接口，尚未替换 `@oryh/dsh-host` 插件的桌面 runtime，也未启用服务器 Profile。当前该工厂的权限生命周期与一个 OAuth grant 对应，不能将第一个浏览器的 grant 固定到多个登录共享的 owner Host。进程间可信请求代理、每次调用的授权归属、Remote 的能力拆分、Agent preset 和 MCP Provider 作用域仍需继续接入。

当前允许的是三类列表读取，不代表详情、表单编辑、保存、提交、审批或所有页面可用。正式业务写入须继续经过统一操作与模型之外的确认流程；不能扩大 GET 白名单来宣称写入功能完成。

第九批全仓 `pnpm verify`：构建、类型检查及 **348 项测试通过**，其中核心层 95 项、服务器实验包 82 项。本轮未改动 Docker/Shell 代码，未重复容器探针；未启用生产 Profile。


## 第十批：插件技能能力拆分与 MCP 作用域接入

核心新增 `OryhSkillService`：统一“刷新技能”和“描述当前技能身份”，不要求 ZIP、文件路径或凭据。桌面运行时通过 `desktopSkillService` 适配原 SkillBundleService，保留强制同步和账号一致性检查。BusinessChat 与 OryhRemote 已改用该接口；`skillSync` 结果类型覆盖桌面安装结果与 MCP 目录刷新结果，已重新生成官方 Remote 描述。MCP 结果没有 `root` 或 `installed`，没有制造假的本地安装记录。

实验包新增 `mountServerSkills`，在调用方指定的 Harness 作用域内注册既有 MCP SkillProvider 和参考资料工具。能力固定绑定 connection 与可信 principal；外来 connection 在网络调用前拒绝；principal 被复制，调用方后续修改不改变身份。刷新只失效目录缓存并重新读取 MCP prompts。授权撤销或插件卸载注销 Provider、取消正在执行的刷新，延迟返回的数据也被丢弃。

`ServerOAuth.createReadRuntime` 将上一批只读业务 Host 与新的 MCP 能力工厂绑定到同一登录 grant。MCP 连接在插件作用域挂载时建立，卸载时关闭；授权仍由已有 OAuth 凭据与刷新服务提供，没有把 token 放到 Remote、Session 或技能内容中。

新增五项技能能力测试使用公开 Cordis、SkillRegistry、Tools 与 `dsh-scope.createScope`，覆盖结果契约、两个同 tenant 不同 user 的目录隔离、Host 全局目录不可见、错误连接/身份、授权撤销和卸载中断。新增一项 OAuth/运行时接线测试证明业务读取与技能能力使用同一 grant、注销后一同拒绝；该接线测试模拟 MCP reader，真实 SDK HTTP 行为仍由原有独立集成测试覆盖。

### 未完成的接入

- `@oryh/dsh-host` 主入口仍保留 developmentOnly 与桌面 runtime，未在 Profile 中启用服务器模式。这里拆掉的是技能接口对 ZIP 的耦合，不是整个插件对桌面运行时的依赖。
- 原 BusinessChat 的桌面工具策略仍包含 Bash 与桌面业务提示；服务器不能直接照搬它。下一步应实现明确的服务器 Agent 组合和只读工具策略，将 Provider 在实际 Agent setup 中挂载，再替换可信 runtime 入口。
- 本批验证的是原生 scope 注册、目录读取和卸载，不是实际 Agent 创建/模型回合。没有注册可写 MCP 业务工具，未验证服务器完整页面、浏览器登录域转接或正式写入确认。
- `createReadRuntime` 属于单个登录 grant，尚未跨进程或接入共享 owner 池。仍禁止把第一个登录的授权固定到共享 Host。

第十批验证：全仓构建和类型检查通过。首次 `pnpm verify` 的页面测试有一项产品选择器超时，随后以单 worker 重跑全部页面测试，43 项通过；服务器实验包重新构建并跑完 88 项测试。连同其余已通过的包，共 **354 项测试通过**。另对生成的 `skillSync` Remote 增加 MCP 结果断言，真实 Cordis/Gateway 测试通过。没有修改超时阈值、启动生产 Profile 或调用真实业务 API。


## 第十一批：原生 Agent setup 与只读工具策略

新增 `createServerReadAgent`，从可信 OAuth grant 创建上一批只读 runtime，再通过公开 `ctx.agents.create` 创建随机 Session ID。必须显式传入服务器分配的绝对 Workspace 目录，不使用进程当前目录作为默认工作区；目录与 owner 的对应关系仍由可信调用方负责，本函数不是浏览器可调用入口。

在尚未发布 Agent 的 setup 阶段加载具名外部插件 `oryh-server-read-agent`，显式注入 skills/tools/systemPrompt，将 MCP Provider、身份上下文和业务读取注册在实际 Agent scope 中。setup 的 commit 再次检查授权。服务器提示独立于桌面 BusinessChat，不承诺保存、提交或审批。

实际执行目录为原生 `skill`、`oryh_skill_reference`、`oryh_skill_sync`、`oryh_list_projects`、`oryh_my_todos`、`oryh_my_expenses`。业务读取调用现有 core Host，没有通用 URL、身份或凭据参数。Harness `tools.restrict` 只限制继承的全局工具，局部工具通过 scoped register 装入；另用公开单调 `tools.guard` 拒绝目录之外或授权已失效的执行，不能被其他 pre-execute 回调改成允许。未挂载 Bash、文件系统、任意 MCP tools/call 或写入工具。

每个原生 pre-step 边界使 MCP 目录缓存失效。服务器技能正文使用只读能力说明，不再要求调用一个实际未安装的 `mcp__oryh__oryh_request`。注销会销毁 Agent handle 并等待原生清理；作用域释放会卸载 Provider 和关闭 MCP 连接。正在创建时撤销授权会回滚，不发布一个没有完成身份接入的 Agent。

### 实际执行证据

新增四项测试，使用公开 LlmRuntime、Session、JSONL、SessionProjection、AgentRegistry、AgentLoop、SkillRegistry、ToolSkill、Tools 和 SystemPrompt。模型采用本地脚本化 LlmAdapter，业务 HTTP 与 MCP reader 是合成 fixture：

- 原生模型回合依次调用 `skill` 和项目查询，收到工具结果后产生回复；目录包含且仅包含上述六项工具。
- 回合事件由真正的 Agent loop 生成并持久化，销毁 Agent 后通过公开持久化读句柄回读一致；内容不包含合成 token。
- 在 Host 上预先注册一个 Bash 测试工具，即使模型明确调用它也不会执行。
- 注销销毁实际 Agent 和技能；MCP 初始化期间注销不会发布 Agent，也不会调用模型。

服务器实验包构建及 **92 项测试通过**。本轮只修改实验包和相应依赖/文档，未修改产品核心、桌面 UI 或 Docker/Shell 探针，因此未重复全仓与容器测试。

### 距离可部署产品仍有的差异

这次已验证真正的原生 Agent/模型协议回合，不再仅是手工写入 Session 事件。但模型、OAuth 服务端和 MCP reader 仍是 fixture，没有真实用户业务请求。Agent 的恢复执行、后台任务中断恢复、模型用量/配额和多用户公平调度尚未接入。

生产 `oryh-client-host` 入口、正式 Profile bundle、完整 Remote/UI 和控制域到 owner 域的浏览器链路仍未切换。当前工厂每 Agent 绑定一个登录 grant，未接共享 owner 进程的逐调用授权。必须先解决这些入口与授权关联，再启用服务器 Profile；不能把测试上下文的手动模块组合视为部署 Profile 已通过。


## 第十二批：外部服务器 bundle 与真实 Loader 生命周期

实验包现在通过公开 `dsh.bundle.patch` 元数据发布独立 `cordis.patch.yml`，包含 11 个明确的原生模块/ORYH 入口，不继承桌面 base/web-app。组合包括 LLM、Session、JSONL、Projection、SystemPrompt、Tools、Skills、AgentRegistry、AgentLoop、ToolSkill 和 `@oryh/server-lab/profile-plugin`。JSONL 默认禁用，必须由可信启动端用 owner 存储目录显式启用；没有隐式回落到用户本机数据目录。没有加入 Shell、目录选择器、文件系统、插件设置或通用 MCP 调用。

新增外部 `oryh-server-read-profile` 插件，要求注入 `oryhServerAuthority` 与原生服务，包括 sessionPersistence。该能力由可信启动代码提供，不是可序列化的 Profile 配置。插件提供 Host 内部的 `oryhServerAgents.start()`，由已绑定身份的工厂创建 Agent；不接受浏览器身份、路径、token 或任意配置参数，也没有增加 HTTP 聊天接口。插件卸载取消正在启动的 Agent，并释放它持有的已启动 handle；取消信号已贯穿原生 setup。

新增三项测试通过公开 `initProfile`、`loadProfileDirectory(userLayer:false)`、`composeEntries` 和 `boot` 执行真实 Loader。测试在临时目录创建 Profile，通过 bundle 的实际 package export 加载编译插件，以可信 overlay 指定 JSONL 目录，prepare 阶段注入授权能力。验证：

- 11 个 bundle 条目实际激活，通过该插件入口创建原生 Agent、查询项目并回复，完整 Profile 关闭后旧入口不能再次创建 Agent。
- 缺少可信 authority 时 boot 拒绝，已初始化的模块由公开 boot 清理。
- Profile 在 MCP 初始化期间关闭时取消未发布 Agent，清理连接，未调用模型。

### 尚未连通的产品链路

这里已从手动模块加载推进到真实外部 bundle/Loader，但 bundle 仍属于 private server-lab。测试启动器直接提供已验证 grant，并没有接浏览器登录路由。包中没有可部署的公网服务器启动命令，也没有替换现有桌面 ORYH Profile。

浏览器原生 New Session/会话恢复入口与该工厂、控制域到 owner 域的一次性转接、Workspace 归属检查、完整 Gateway/附件访问、实际多用户模型配置及 ORYH 业务页面仍待接入。下一步需要沿原生入口做这些关联，不能绕过工厂直接开放无限制的 AgentRegistry.create。模型和业务服务继续使用 fixture，本批不是生产上线验收。

第十二批验证：服务器实验包构建和 **95 项测试通过**。本轮仅修改实验包及文档，未重复未变更的桌面、核心业务和 Docker/Shell 测试；未进行真实模型或业务 API 调用。


## 第十三批：浏览器入口审计与可信 Workspace 能力

审计原生 SessionController 的创建、恢复、fork、查询/流和 Workspace 路径后，确认这些入口尚未接入已实现的 ORYH Agent 工厂。没有直接启用它们，避免出现已登录却绕过 owner admission 的路径。实际公开扩展点及后续连接要求见 [原生入口接入清单](30-native-session-admission.md)。

新增 `owner-workspace.ts`：在私有服务器数据根下按可信 owner hash 分配目录，签发 WeakMap 识别的不可序列化工作区能力。`createServerReadAgent` 现在要求该能力与 grant.owner 一致，不再接受绝对路径字符串。目录在分配和使用前检查权限、UID、符号链接与实际路径；复制能力、JSON 仿造、其他 owner、共享目录或目录被替换后均拒绝。

新增三个目录/能力测试和一个真实 Agent 工厂拒绝仿造工作区的测试。原有 Profile/Loader 和原生 Agent 回合测试已经改用分配的 owner workspace。此次没有修改 Harness 私有代码或新增聊天接口，没有声称浏览器登录到会话的完整链路已经完成。能力属于进程内 admission，不替代 OS 隔离、原生 Workspace ID、持久化 owner 索引或 HTTP 资源鉴权。

第十三批验证：服务器实验包构建及 **99 项测试通过**。修改限于实验包和文档，未重复未变化的桌面与容器测试，也未调用真实模型或业务 API。

## 部署推进复核（2026-09-14）

ORYH 最新 main 已提供 OAuth revoke，客户端完成调用、旋转后 token 的撤销以及远端失败仍销毁本地授权的测试。新增外部 ServerGateway，在公开 invoke/stream 边界执行归属校验，真实 HTTP/WS 测试通过；嵌套历史地址和旧桌面 preset 不可绕过检查。

本次完整实验测试 105 项通过，之后增量 5 项通过（其中新增 2 项部署预检测试）。Docker 合成隔离探针通过并清理资源。真实测试站 HTTPS 返回 Kubernetes 默认自签名证书，OAuth 联调未进行；客户端也仍存在原生 UI/业务/确认及发布组合缺口。见[部署状态与缺口](31-server-deployment-status.md)，不可报告为已部署。


## 2026-09-15 服务端复查与原生会话接通

HTTPS / OAuth discovery / MCP resource 预检通过，未授权访问返回 401；已部署撤销接口返回符合契约的空 200；浏览器真实账号登录成功。此前 TLS 阻塞已关闭。

增加 native-binding/native-preset 公共插件入口，工具组合经真实 standing preset 复用；实际 SessionController + Gateway HTTP 完成创建 → prompt → 查询 → 模型回复，拒绝非法路径、其他会话及已撤销请求。完整实验包 110 项测试通过；落盘会话归属新增断言的 Agent 回归 11 项通过。详细边界见[部署状态](31-server-deployment-status.md)。未将合成 OAuth/MCP 或脚本化模型作为真实端到端证据。
