# ORYH AI Client 多用户服务器（M1）

多个租户、多个用户共用一台服务器：浏览器登录 ORYH 后进入**本人的**工作台（中间栏页面 + Chat）。M1 只读，写入会被拒绝并说明原因。架构与边界见 [docs/33](../../docs/33-server-m1-plan.md)。

与 `deploy/local`（单用户开发容器）不同：这里每个登录的人有独立的 owner Host 进程、数据目录和子域名；ORYH 凭据只在控制进程里，owner Host 拿不到。

## 本机运行

两种方式都需要仓库根目录的 `.env`：

```sh
ORYH_SERVER_ORIGIN=https://calwbiz-new.banff-tech.com   # compose 默认即此测试环境
ORYH_MODEL_API_KEY=<模型 Key>
ORYH_MODEL_BASE_URL=https://credit.banff-tech.com/v1
```

**直接运行（开发）**：另加 `ORYH_DATA_ROOT=<绝对路径>`，然后在 `oryh-ai-client/` 执行 `corepack pnpm server:dev`。

**Docker**（源码目录并列放置 `deepseek-harness/` 与 `oryh-ai-client/`）：

```sh
docker compose -f deploy/server/compose.yaml --env-file .env build --build-arg DSH_CLIENT_COMMIT_HASH="$(git -C ../deepseek-harness rev-parse HEAD)"
docker compose -f deploy/server/compose.yaml --env-file .env up -d
```

用 Chrome 打开 `http://localhost:4300/`，登录 ORYH 并授权后会跳到 `http://<32 位标识>.localhost:4300/`，那是本人的工作台。Chrome 会把 `*.localhost` 直接解析到本机，不需要改 hosts。第一次进入要等本人的 Host 启动（约 5–20 秒）。

## 资源

- 每个登录中的人占一个 owner Host 进程，约 0.6 GB 内存。`ORYH_HOST_CAPACITY`（compose 默认 10）限制同时运行的数量，超过时新登录会失败；`ORYH_HOST_IDLE_MS`（默认 5 分钟）后回收无人使用的 Host。
- compose 默认 `mem_limit: 7g`（10 × 0.6 GB + 1 GB），调整容量时按 `容量 × 0.6 GB + 1 GB` 同步调整 `ORYH_SERVER_MEMORY`。内存只在对应人数同时在线时才会实际占用。

## 生产部署

1. **域名**：一个公共域名和它的泛子域，例如 `client.example.com` 与 `*.client.example.com`，都指向服务器。
2. **证书**：泛域名证书只能用 DNS 验证签发，见 [`Caddyfile`](Caddyfile)。
3. **`.env`**：

```sh
ORYH_CLIENT_PUBLIC_ORIGIN=https://client.example.com
ORYH_CLIENT_OWNER_DOMAIN=client.example.com
```

   compose 端口改为只对反向代理开放。

4. **反向代理**：必须去掉 `X-Forwarded-*` 和 `Forwarded` 头，登录路由会拒绝带这些头的请求；Host 头保持原样。

## ORYH 侧前提

- **授权表字段**：ORYH 需包含把 `oauth_authorization_codes.code_challenge` 改为 text 的修改（calwbiz `ecab43d`）。服务器版的授权请求约 220 字符，否则登录后授权页 500。
- **回调地址**：client_id 为 `<公共域>/oryh/client.json`，回调为 `<公共域>/oryh/auth/callback`。ORYH 只允许回调到 client_id 所在的 https 主机或回环地址，两者同域即可。

## 数据

- **数据卷**：`server-data` 卷保存每个人的会话、Chat 绑定、草稿（加密）和技能，以及自动生成的草稿主密钥 `.store-master-key`。也可以用 `ORYH_STORE_MASTER_KEY` 指定。
- **重启**：登录状态只在控制进程内存中，重启后需要重新登录；会话和草稿保留。
