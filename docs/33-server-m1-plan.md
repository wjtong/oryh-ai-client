# 服务器版 M1：多用户只读可用

状态：实施中（2026-09-15 起）
依据：[docs/19](19-multi-tenant-server-plan.md) 路线（2026-09-15 用户选定），在 [docs/27](27-server-p0-implementation.md)–[32](32-server-connections.md) 的 server-lab 原型上继续。第一版部署形态：单台 Linux + Docker。

## 1. 目标

浏览器打开服务器地址 → 用 ORYH 账号登录并授权 → 进入**本人的** ORYH 工作台：中间栏页面和 Chat 都可用，读业务数据、按 MCP 读取技能、调用只读 ORYH 工具。同一台服务器上多个租户、多个用户各用各的，互不可见。

M1 **不开放写入**：保存、提交、审批等写操作由控制服务拒绝并说明原因。写入需要 docs/19 §6 的可信确认与回执，放在 M2。

## 2. 与原型相比的三处关键变化

1. **owner Host 加载真正的产品 Profile。** 原型的 worker 只装最小探针（WebServer、Gateway、存储），会话栈只在测试夹具里。M1 的 worker 是带 IPC 通道启动的 `dsh` 启动器本身，加载 web 模板 + ORYH bundle + 服务器限制 bundle，得到和桌面版同一套页面与 Chat；`@oryh/dsh-host` 以服务器模式运行。
2. **凭据经 IPC 代理。** 原型把进程内的 `ServerOAuth` grant（WeakMap 对象）直接交给 Host，跨进程不成立。M1 中 grant 只在控制进程；worker 里的 `OryhClientHost` 使用委托传输，每个 ORYH API 和 `/mcp` 请求经 IPC 交给控制进程，由 broker 按策略放行、附加 Bearer、转发并回传状态与响应体。worker 进程和其子进程拿不到 ORYH token。
3. **owner 路由。** 登录回调后签发一次性票据，重定向到 owner 子域 `<label>.<base>`；owner 域兑换票据后发放本域会话 Cookie，把请求（含 WebSocket）转发到该 owner 的 Host，并注入 Host 的内部认证 Cookie。`label` 取 owner hash 前 32 位十六进制（DNS 标签不超过 63 字符）。本机开发使用 `*.localhost`，生产使用泛域名 + 泛证书。

## 3. 进程与信任边界

```
浏览器 ─ HTTPS ─► 控制进程（可信）
                   ├─ 登录（ServerOAuth，多个 ORYH 服务器）
                   ├─ grant 池：owner → 该 owner 的全部浏览器授权
                   ├─ broker：策略 + 附加凭据 + 转发 ORYH/MCP
                   ├─ RuntimePool：每 owner 一个 Host 进程，generation、空闲回收
                   └─ owner 域代理：票据兑换、会话 Cookie、HTTP/WS 转发
                        │ IPC（请求 id、owner、generation）
                   owner Host 进程（每 owner 一个，产品 Profile，数据根私有）
```

- **owner** = `sha256([ORYH issuer, tenant_id, user_id])`，只由 ORYH `/auth/me` 的结果计算。
- **broker 策略（M1）**：`GET /api/v1/...` 放行；`POST /mcp` 只放行 `initialize`、`tools/list`、`prompts/*`、`resources/*`，以及 `tools/call` 中服务器标注只读的工具和 `method=GET` 的 `oryh_request`；其余一律拒绝。每次转发前核对 owner 与 generation。
- **模型密钥**：部署级配置，由控制进程以环境变量交给 owner Host；M1 不开放命令执行，见 §6。
- **Profile 限制**：关闭 Bash/终端、目录选择、模型设置、插件管理；工作区固定为 owner 数据根下的 `workspace`。Gateway 使用 `ServerGateway` 执行 owner 准入，见 §6。

## 4. 已知仍未解决（M1 如实保留）

- 各 owner Host 进程使用同一系统 UID，不构成针对恶意代码的隔离；因此 M1 不开放 Bash 与任何脚本执行（docs/19 §5.3 的独立执行容器在后续阶段）。
- `$events`、`$events/result` 与附件 Fetch 不经过 `ServerGateway` 覆盖（docs/30）。在单 owner 进程中它们只能触及本人数据，但仍需 Harness 公开的 admission 扩展才能与 generation 失效严格对齐。
- 控制进程的 grant、会话和票据保存在内存中，重启后需要重新登录。

## 5. 批次与验收

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| A | core：`createServerOryhRuntime`（委托传输、MCP 技能服务、owner 数据根下的存储）；`@oryh/dsh-host` 服务器模式 | 单元测试：业务读取经委托传输返回；ORYH 错误状态保留（409/422 等领域提示照常）；服务器模式不读钥匙串 |
| B | broker 与 IPC 协议 | 策略测试：GET 放行、写入与非只读 MCP 工具拒绝、owner/generation 不符拒绝、token 不出现在 worker 可见数据中 |
| C | worker 加载产品 Profile + 服务器限制补丁 | 进程测试：两个 owner 各自启动，页面 Remote 可用，禁用的能力不可达 |
| D | 控制服务入口：登录 → grant 池 → RuntimePool → 票据 → owner 域代理 | 集成测试（合成 ORYH）：登录后进入本人工作台；另一 owner 的 Cookie/票据不可用；登出一个浏览器不影响同 owner 其他浏览器；最后一个授权结束时回收 Host |
| E | `deploy/server`：镜像、compose、反向代理示例；真实 ORYH 端到端 | 本机 Docker 上两个真实账号同时使用；「我的工时」和 Chat 读取正常；写入被拒绝并有说明 |

## 6. 实施记录

### 批次 A–C（2026-09-15）

- **A**：`createServerOryhRuntime`（core）经委托传输访问 ORYH，保留 ORYH 状态码，服务端拒绝的原因原样传回；草稿密钥由服务器下发并按存储派生。`@oryh/dsh-host` 的 `mode: server` 通过 IPC 领取配置；Chat 按部署能力去掉 bash、声明只读。
- **B**：`OwnerBroker`（server-lab）执行 §3 的只读策略并附加 grant 的 token；IPC 链路与配置握手放在 core（`server-ipc.ts`），owner Host 与控制进程两端共用。
- **C**：owner Host 由 `startOwnerHost`（server-lab）以子进程启动真实 `dsh` 启动器。
  - **Profile**：每个 owner 在自己的 `DSH_HOME/profiles/oryh-server` 写一个小 Profile：web 模板 + `@oryh/dsh-bundle` + `@oryh/server-bundle`，启动时冻结补丁。
  - **不共享 Profile 目录**：Harness 每次启动会把 bundle 依赖链接进"它启动时看到的 Profile 路径"，共享目录会被改写成指向最后启动的 owner。
  - **agent 工具来自 preset**：web 模板在宿主层本就停用了 bash/文件/技能等行，真正给 agent 的工具由 Agent preset 装载。服务器 bundle 因此只提供 `oryh-server` preset（技能、提问、待办、上下文压缩），关闭内置与用户 preset。
  - **准入**：用 `ServerGateway` 替换 `typert-gateway`，`oryh-owner-admission` 拒绝凭据、模型发现与切换、动态代码、插件清单、preset 管理、目录选择，只允许修改外观类设置，工作区限定为分配目录，新会话固定服务器 preset。当前是按危险面拒绝；`ORYH_ADMISSION_TRACE=1` 记录每次决定，批次 E 用真实页面操作收集调用清单后收紧为白名单。
- **实测**（`ORYH_OWNER_HOST_TEST=1` 的进程测试）：
  - 启动约 5 秒，首次构建后冷启动约 17 秒；每个 owner Host 常驻约 570–600 MB。
  - 16 GB 开发机上同时只宜运行 1–2 个；生产容量按每人约 0.6 GB 规划，空闲回收是必需的。
  - 经 IPC 取得身份并经 broker 访问 ORYH；准入拒绝凭据、preset 与模型设置写入。
  - 用替身模型接口截获一轮对话：agent 工具只有 `skill` 与 ORYH 工具，无 bash、文件、网页、子代理、工作流。
- **模型密钥**：以环境变量交给 owner Host（Harness 视为只读、优先级最高）。M1 不开放任何命令执行，子进程也不会继承到它；有执行容器后改为经控制进程代理。

### 批次 D（2026-09-15）

- **控制服务**：`startControlServer`（`server-lab/src/control-server.ts`）组合现有的 `mountLoginRoutes`、`ServerOAuth`、`RuntimePool`、`OwnerBroker` 与 `startOwnerHost`。
  - **grant 池**：每个 owner 保存全部浏览器授权，新的在前；broker 使用第一个仍然有效的，某个授权结束时自动移出。
  - **路由**：公共域 `/` 在已登录时签发 60 秒一次性票据，重定向到 `<owner hash 前 32 位>.<ownerDomain>/oryh/enter`。owner 域兑换后发放本域 `oryh-owner` Cookie（绑定登录会话和 Host 租约），此后 HTTP 与 WebSocket 都转发到该 owner 的 Host。转发时换成 Host 的内部 Cookie，去掉 Host 返回的 Set-Cookie，并拒绝跨源写请求和跨源 WebSocket。
  - **回收**：同一个人多个浏览器共用一个 Host；登出一个不影响其他；最后一个结束后按 `idleMs` 回收 Host。
- **入口**：`control-main.ts` 从环境变量读取配置（见文件头注释），本机开发用 `pnpm server:dev`（读取仓库根目录 `.env`）。本机的公共域为 `http://localhost:4300`，owner 域为 `<label>.localhost:4300`，Chrome 无需 DNS 即可解析。
- **测试**：`control-server.test.ts` 用合成 ORYH 和替身 Host 覆盖登录进入、Cookie 不外泄、经 broker 访问、票据只用一次、owner 隔离、WebSocket 转发与跨源拒绝、多浏览器登出与 Host 回收。
- **真实 ORYH 前提**：
  - 授权请求带 `resource`、43 位 state 和本机 client_id，同意指纹约 220 字符。ORYH 需要包含把 `oauth_authorization_codes.code_challenge` 改为 text 的修改（calwbiz `ecab43d`），否则登录后授权页 500。
  - 反向代理不得转发 `X-Forwarded-*`/`Forwarded` 头到登录路由，登录路由会拒绝带这些头的请求（批次 E 处理）。

### 批次 E（2026-09-15，进行中）

- **准入改为白名单**：用 `probes/ui-trace.mjs`（合成 ORYH + 真实控制服务 + 一个真实 owner Host）在浏览器里走了登录、待办、工时、项目、企业连接、Chat 发消息、新会话、文件面板，记录网关实际收到的调用。
  - 据此放行 `oryh`、`session`、`workspace`、`workspaceFiles`、`settings`（写入只限外观类命名空间）、`credentials.describe`（只查是否已配置，不含值），以及命令、技能、附件、上传、文件引用、反馈等命名空间的必要方法。其余全部拒绝。
  - 复查同样的操作没有误拒。
- **两处修正**：
  - Web 模板会在启动时调用 Cordis 调试面板的 `dynamicCordisRunner`，服务器 bundle 已关闭 `ui-cordis` 与 `cordis-host-runner`。
  - 不能用子类行替换原生 Gateway：浏览器端模块表按行所属的包收录，替换后浏览器端 Gateway 缺失，工作台无法加载。准入改为在 Gateway 实例的公开 `invoke`/`stream` 上包装。
- **部署**：新增 `deploy/server`（Dockerfile、compose、Caddyfile 示例、README）。控制服务新增监听地址配置，容器内监听所有接口，本机端口只映射到 127.0.0.1。
- **待完成**：真实 ORYH 账号登录（需要账号本人操作）；Docker 镜像构建与两个账号同时使用。
