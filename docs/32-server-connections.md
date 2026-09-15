# ORYH 服务器地址配置

更新：2026-09-15。ORYH AI Client 不绑定单一 ORYH 部署，也不把官方站点列表当作允许范围。

| 站点 | 建议地址 |
| --- | --- |
| 国际站 | `https://oryh.ai` |
| 国内站 | `https://oryh.cn` |
| 测试环境 | `https://calwbiz-new.banff-tech.com` |
| 独立部署 | 用户自己的 ORYH 根地址，例如 `https://erp.example.com` |

测试环境的 HTTP 入口已实测跳转到 HTTPS。国际站和国内站地址由用户指定，本次没有对它们进行登录测试。

## 用户操作

在“企业连接”输入或选择 ORYH 服务地址，再到对应站点完成授权。已有桌面 DSH 插件继续支持任意自定义服务地址；三个建议值不限制自由输入，也不自动替用户选择站点。

一个连接包括服务器、租户和账号。切换服务器意味着选择或建立另一个连接，不能修改现有连接的 origin 后沿用原凭据。聊天、草稿、显示偏好及模型密钥应按连接归属管理；不同服务器不能因为 tenant/user ID 恰好相同而共享工作区。

服务器模式的 owner 键已包含规范化的服务器 origin、tenant ID、user ID。别名域名不会自动合并；变更域名应执行明确的迁移，避免把恶意或错误的新域名当作原服务器。

## 服务器版配置与边界

共享部署的 AI Client 由管理员配置可连接的服务器条目，用户从中选择。条目不局限于三个已知站点，可以配置自部署域名，包括经运维配置可达的内网 HTTPS 服务。独立部署 AI Client 的用户自行配置这些条目。当前不开放浏览器未经校验提交任意网络目标的注册接口；后续若需要普通用户自助添加服务器，必须补上地址审核及网络出口限制，不能直接把输入拼入带凭据请求。

外部 Host 登录适配器现接受单个 `ServerOAuth`（兼容旧调用）或多个条目：

```ts
mountLoginRoutes(ctx, [
  { id: 'international', label: 'ORYH 国际站', oauth: internationalOAuth },
  { id: 'china', label: 'ORYH 国内站', oauth: chinaOAuth },
  { id: 'company', label: '企业自部署', oauth: companyOAuth },
], {
  publicOrigin: 'https://client.example.com',
  acquire: (grant, signal, oauth) => acquireRuntimeFor(grant, signal, oauth),
})
```

这是可信 Host 配置的组合示例；变量需由部署端构造，不是可直接执行的安装配置。每个 OAuth 实例使用各自固定的 `issuer`，共享同一个客户端 metadata URL 和 callback URL。`acquire` 收到本次所选的 OAuth 实例，不能退回使用某个全局默认实例。客户端根域名与 ORYH 服务端域名是两个独立配置。

- `GET /oryh/auth/servers` 仅返回条目 ID、显示名和服务器 origin。
- `GET /oryh/auth/login?server=company` 选择已配置条目；省略 server 使用第一条。重复参数、未知条目、原始 URL 和替代 issuer 参数被拒绝。
- 登录事务将最初选择的服务器固定到浏览器绑定及 OAuth state。callback 不从查询参数重新选服务器；若授权服务器返回 `iss`，必须匹配原始选择。
- Token 交换、刷新、业务请求、MCP 与撤销均沿用该服务器的 OAuth 实例；不会因另一个用户或标签页选择其他服务器而改变。
- `/oryh/auth/session` 返回当前服务器的安全显示信息；令牌不进入返回内容。
- 服务器版要求可信 HTTPS。可以安装企业 CA，但不能以关闭 TLS 校验支持自签名证书。当前不支持挂在 URL 子路径下的 ORYH 部署，只接受根 origin，可包含端口。

## 实现和验收状态

已实现桌面插件地址建议与自由输入、多服务器登录路由、所选实例传入 runtime 获取、回调 issuer 检查和跨服务器 owner 隔离测试。服务器实验完整测试 111 项通过，包含相同 tenant/user ID 在不同服务器下的登录隔离与独立退出。

完整服务器登录页面、持久化的管理员服务器管理界面及多用户发布 Profile 仍未交付。上述后台能力不等同于已部署的完整服务器产品；当前剩余交付项见[部署状态](31-server-deployment-status.md)。
