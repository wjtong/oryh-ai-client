# ADR-0005：分离账号认证、设备授权、本地解锁和高风险 step-up

- 状态：接受
- 日期：2026-08-19

## 背景

桌面客户端打开时需要同时处理 ORYH 账号身份、一个安装实例的长期连接、本地数据暴露和高风险业务动作。把它们都叫“登录”会产生两个相反问题：每次启动都要求 ORYH 密码会破坏体验，而一次 device approval 后永久静默使用又无法保护本地缓存和高风险操作。

ORYH 当前提供参考 RFC 8628 的浏览器 device flow、24 小时个人 access key、旋转 refresh token 和 `/auth/me`。系统浏览器会话、本地 OS 用户状态和业务动作的认证新鲜度具有不同的证明对象，不能互相替代。

## 决定

1. ORYH 账号认证只在系统浏览器进行；客户端不内嵌登录 WebView、不收集密码、不读取浏览器 Cookie。
2. 首次连接和重新连接使用 device flow。一次批准只给一个安装实例、一个 ORYH origin、一个 tenant 和一个 user 建立可单独吊销的 `Connection`。
3. 日常启动不重复 ORYH 登录。客户端先按策略完成 OS 本地解锁，再刷新或验证上次活动连接，并以 `/auth/me` 成功作为 `Ready` 门槛。
4. 本地解锁只释放本机 Keychain 凭据和加密数据；它不改变服务端权限，也不被描述为 ORYH MFA 或 step-up。
5. R4 动作需要 ORYH 服务端表达并验证认证强度与新鲜度。没有服务端 step-up 时，不开放依赖该保证的动作。
6. “锁定客户端”“断开企业”“删除本地数据”“退出 ORYH 浏览器”是四个不同动作和文案。
7. 断开企业必须先调用服务端当前设备撤销，再删除本地凭据；离线时不能声称已完成远端吊销。
8. access/refresh 以单个版本化 credential bundle 原子保存；同一 connection 只有一个 refresh single-flight。
9. 多企业连接分别验证和刷新；一个 DSH Session 仍固定绑定一个 `ConnectionId`。

详细状态机和后端要求见 [登录、认证与设备会话设计](../09-authentication-and-login.md)。

## 后果

正面结果：

- 日常打开客户端足够快，不需要反复登录；
- 密码、浏览器 Cookie 和 token 都不进入 Renderer 或模型；
- 锁屏、设备丢失、远端吊销和 refresh 失效有不同且准确的恢复路径；
- 本地生物识别不会被错误当成企业身份保证；
- 多企业连接、Session 和凭据生命周期可以独立审计和删除。

代价与依赖：

- 桌面壳需要 OS user-presence、锁屏/睡眠事件和 Keychain 原子替换能力；
- ORYH 后端必须补齐普通用户自助设备列表/吊销、设备交付并发安全、approved secret TTL、recent auth 和机器错误码；
- R4 需要服务端 step-up 协议，客户端不能单方面完成；
- refresh 在服务端成功旋转但客户端保存前崩溃时，可能为了安全要求用户重新连接。

## 未采用方案

### 客户端内嵌 ORYH 登录页

拒绝。嵌入 WebView 会让客户端接触账号输入和 Cookie，妨碍 SSO/MFA，并扩大 Renderer 被利用后的后果。

### 每次启动都重新走 device flow

拒绝。device flow 是设备授权，不是普通应用解锁；重复授权会制造设备凭据、增加浏览器摩擦并弱化用户对批准动作的理解。

### 一次连接后永不本地锁定

拒绝。它把已解锁 OS 会话、离开工位和设备唤醒后的风险全部留给长期 refresh token 和本地缓存。

### 用 Touch ID 或 Windows Hello 代替 ORYH step-up

拒绝。本地 user presence 不能向 ORYH 服务端证明登录方式、认证时间、企业账号或动作授权，不能独立保护付款和权限变更。

### 只删除本地 Keychain 项作为“退出”

拒绝。服务端授权仍可能有效，遗留 token 副本或备份可以继续使用。远端撤销和本地删除必须有可区分的完成状态。

## 重新评估条件

以下变化触发重新评估，但不得放宽“秘密不进入 Renderer/模型”和“服务端最终验证 R4”的不变量：

- ORYH 采用完整 OAuth/OIDC authorization code + PKCE 或标准 device grant；
- ORYH 引入 DPoP、硬件设备身份或企业证书；
- 客户端改为纯浏览器 BFF 架构；
- OS 平台提供新的硬件保护与远程设备合规能力。
