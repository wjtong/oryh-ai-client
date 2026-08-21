# ADR-0002：凭据不得进入模型上下文

状态：接受
日期：2026-08-19

## 背景

ORYH 当前 personal Skill bundle 会把用户 access token 渲染进 Markdown，方便通用 Agent 通过 `curl` 调 API。DSH 的模型可见内容会写入 Session 以支持重放；因此把真实 token 写进 Skill 会同时扩大到模型 Provider、Session、缓存、日志和遥测。

DSH 的本地 YAML credential provider 使用 owner-only 文件权限，但同一 OS 用户下的工具进程仍可读取该文件，不能作为模型隔离的安全边界。ORYH 专属客户端又不需要让模型自己拼接 HTTP，因此可以把认证完全移出模型平面。

## 决定

1. ORYH access token、refresh token、模型 key 和本地加密 key 不进入模型请求、Skill、Session、Renderer、普通日志、遥测或诊断。
2. 生产使用 OS Keychain/Credential Manager provider 保存秘密。
3. Session 和工具只持有不解析秘密的 `ConnectionId`；ORYH API service 在主进程传输层解析正确 credential reference。
4. refresh 由确定性 auth/API service 处理，不由模型根据 401 文本决定。
5. ORYH Skill 同步必须使用无凭据内容接口；客户端不得下载含 token bundle 后依靠文本清理作为生产方案。
6. 生产 Profile 禁用能读取任意用户文件的模型工具，作为额外纵深防御。
7. 测试使用 canary secrets 扫描模型、Session、UI、日志、诊断和构建产物。
8. 每个连接的 access/refresh、到期时间和 generation 作为一个 credential bundle 原子替换；本地锁定只释放或清除内存秘密，不改变服务端授权。

## 后果

正面：

- token 不会因正常对话和重放而持久扩散；
- refresh 和重试在一个实现中保持正确；
- 模型无法有意或被注入地回显真实认证信息；
- 多企业凭据选择由 Session scope 决定，而不是 Skill 文件名或模型判断。

代价：

- 需要实现跨平台 Credential Provider；
- ORYH 后端需要提供无凭据 eligible Skill 内容；
- 通用 Bash/curl Skill 不能直接复用，必须有窄业务工具；
- 本地高信任 Host 仍需严密保护和签名发布。

## 未选择的方案

### 继续把短期 access token 写入 Skill

拒绝。短期 token 只缩短泄漏窗口，不能关闭泄漏通道，且 Session 可在过期后继续保存秘密。

### 使用环境变量

拒绝。子进程、诊断和同 UID 进程容易读取；也不能可靠表示多租户和轮换。

### 使用 `0600` YAML credential 文件

仅允许无真实秘密的开发测试。它隔离其他 OS 用户，不隔离模型拥有的同 UID 文件读取能力。

### 让 Renderer 管理 token

拒绝。XSS、DevTools、前端网络状态和浏览器存储都会扩大攻击面。

## 重新评估条件

该安全不变量不计划放宽。未来可以把 OS Keychain 替换为企业设备身份、硬件保护或模型/ORYH 网关，但仍需保持秘密不进入模型和 Renderer。
