# 本地 Compose 业务验证

这是完整 ORYH **单用户开发版**的容器入口。运行原生 DeepSeek Harness Web Profile 与 ORYH 外部插件，不是多用户服务器版；不要用于多租户隔离验收或对公网开放。

## 启动

源码目录必须并列放置：`deepseek-harness/` 与 `oryh-ai-client/`。在 `oryh-ai-client/` 执行：

```sh
docker compose build --build-arg DSH_CLIENT_COMMIT_HASH="$(git -C ../deepseek-harness rev-parse HEAD)"
docker compose up -d
docker compose logs client
```

首次访问须使用日志中 DSH 打印的认证链接，将其主机与端口改为 `127.0.0.1:4180`，保留路径和认证参数。成功后可以直接访问 `http://127.0.0.1:4180/`。换浏览器或清理 Cookie 后，需要重新使用认证链接。不要公开分享日志中的认证参数。

客户端仅发布到本机 `127.0.0.1:4180`。Harness 在容器内保持 `127.0.0.1:4174` 的回环监听，通过 TCP 转发器接收容器端口 4173 的流量；原生认证、Host/Origin 检查和 WebSocket 协议保持不变。`compose.yaml` 的 `ORYH_SERVER_ORIGIN` 默认设置为测试环境 `https://calwbiz-new.banff-tech.com`（HTTP 入口会重定向至 HTTPS）。企业连接页面会预填此地址，用户仍可修改为 `https://oryh.ai`、`https://oryh.cn` 或自建站点。

打开「企业连接」完成 ORYH 授权。Chat 使用 Harness 原生模型配置；在「模型与设置」填写自己的模型、Base URL 和 API Key，并选择容器内 `/home/node/workspace` 为工作区。主机上的模型设置、企业凭证和文件不会自动复制进容器。

## 数据与生命周期

- `client-data` 命名卷保存 Profile、模型配置、会话、工作区和业务草稿。
- ORYH 业务凭证及草稿加密密钥由容器内 Linux Secret Service 保存。其自动解锁密码随机生成于命名卷私有文件，权限为 0600；这是信任同一 UID 的单用户开发部署，不提供服务器多用户秘密隔离。
- `docker compose stop` 停止；`docker compose up -d` 再启动。普通 `docker compose down` 保留数据。
- **不要使用 `docker compose down -v`，除非要永久删除上述数据。**
- 更新源码后重新 build、up；不在镜像中保存 ORYH 密码或模型 API Key。

## 本机验证限制（2026-09-15）

当前 Docker Desktop 内核为 `5.15.49-linuxkit-pr`。Landlock 实际探针返回 `ENOSYS`（系统调用未实现），因此不能据此验收 Chat 的受限脚本执行。镜像已包含 Harness 原生 Linux 沙箱程序，但没有关闭安全策略、切换 Full Access 或使用 privileged 容器。业务页面与企业连接入口可供操作；模型配置和需要脚本执行的技能应分别验证，不能把页面健康检查视为 Chat 全链路成功。
