# 服务器版 M2：写入方案

状态：方案已确认（2026-09-15），待实施
依据：[docs/19](19-multi-tenant-server-plan.md) §6.4、§7.1，[ADR-0010](adr/0010-agent-is-the-primary-client.md)，[docs/33](33-server-m1-plan.md) 的 M1 实现

## 1. 目标

服务器版能保存、提交、审批，Chat 和页面都能写，确认方式与桌面版一致：

1. **页面写入经用户确认**：沿用页面的核对与确认；执行的请求与确认时的请求规范化后完全一致（按摘要比对），内容变了、过期、重复使用都拒绝。
2. **Chat 写入按技能确认**：与桌面版相同（ADR-0010）。技能要求写前确认，agent 就在对话里确认；技能没有要求，就直接执行。客户端不另加确认。
3. **结果可信**：只有 ORYH 返回成功才算成功；响应丢失时进入"待核对"，不自动重发。
4. **留有回执**：谁、在哪个会话、发出了什么、ORYH 返回了什么，都有记录可查；同一笔写入不会被发送两次。

仍不做：命令/脚本执行（M3）、跨用户实时同步（M4）。

## 2. 现状

| 写入路径 | 现在怎么写 | 服务器版 M1 |
| --- | --- | --- |
| 页面（工时、费用、项目） | 领域服务已有完整意图机制：`prepare` 预校验（`validate_only`）并生成一次性确认令牌和内容摘要 → 用户点确认 → `confirm` 复核摘要、标记"执行中"、发送、不自动重试 → 结果不明时 `reconcile` 用写进单据的 `oryh_client_intent_id` 回查 | broker 一律拒绝 |
| Chat | agent 按 ORYH 技能调用 MCP 的 `oryh_request`（任意方法、路径、正文）；技能要求写前在对话里确认一次（ADR-0010） | broker 拒绝非 GET |

- **已部署的 ORYH**：只有计费模块支持幂等键；工时、审批记录等靠单据里的客户端意图标识回查。
- **正在开发的 ORYH**（calwbiz 工作区中，尚未提交）：通用幂等中间件 `app/core/idempotency.py`。
  - 所有 `/api/v1` 写接口接受 `Idempotency-Key`：同键同请求重放首次应答，同键不同请求返回 422，同键进行中返回 409；
  - MCP 的 `oryh_request` 以 `idempotency_key` 参数传入。

## 3. 信任边界

沿用 docs/19 §4：控制进程和 owner Host 是可信区域，执行容器（M3）之外的模型输出和业务数据是不可信数据。M2 仍不开放命令执行，owner Host 进程里运行的只有受信代码。

- **写入描述由 owner Host 的受信代码附加**：页面写入附带用户确认过的意图；Chat 写入附带发起它的会话和工具调用。模型提供的是业务参数，不能伪造这些描述。
- **放行由控制进程决定**：broker 对每个写入请求核对写入描述（页面写入还核对摘要、有效期）、操作是否在开放清单、操作 ID 是否已用过，写入回执后才发送。owner Host 里某条路径出错时，也会在 broker 处被拒绝或至少留下回执。
- **Chat 写入的边界与桌面版相同**：是否确认由技能决定，agent 只执行用户在对话里明确要求的写入（ADR-0010 边界）；ORYH 的权限校验与状态机仍是最终闸门。服务器版因此不承诺"Chat 写入必经人工确认"，这是对 docs/19 §7.1 规划的有意调整（2026-09-15 用户决定）。
- **凭据仍只在控制进程**。

## 4. 设计

### 4.1 写入请求携带写入描述

`OryhRequest` 增加可选字段 `operation`（桌面版忽略），经委托传输和 IPC 传给 broker：

```
operation: {
  kind: 'page' | 'chat'
  operationId: string      // 一次写入一个，全局唯一；页面用意图 ID，Chat 由 Host 为每次工具调用生成
  digest?: string          // 页面：用户确认时的规范化请求摘要
  confirmedAt?: number     // 页面：用户确认的时间
  sessionId?: string       // Chat：发起写入的会话
  callId?: string          // Chat：发起写入的工具调用
}
```

摘要 = SHA-256(方法 + 路径 + 规范化 JSON 正文)。MCP 写入的"请求"指 `tools/call` 的工具名与参数。

### 4.2 broker 的写入策略

对非只读请求（REST 非 GET、`validate_only` 除外；MCP `tools/call` 的写工具和非 GET 的 `oryh_request`）依次检查：

1. 有有效授权（M1 已有）。
2. 带 `operation`。页面写入还要求 broker 自己算出的摘要等于 `digest`，且 `confirmedAt` 在有效期内（建议 5 分钟）；Chat 写入要求带 `sessionId` 与 `callId`。
3. `operationId` 从未出现过（持久化去重，防止重复发送）。
4. 操作在首批开放清单内（第 6 节）；不在清单的写入仍拒绝，并说明"服务器版暂未开放此操作"。

通过后先写回执 `sent`，再发送；按 ORYH 应答更新为 `succeeded`（2xx）、`rejected`（400/401/403/404/409/422，明确未写入）或 `unknown`（超时、断连、5xx，结果不明）。

### 4.3 页面写入

领域服务的 `confirm` 在发送时附带 `operation: { kind: 'page', operationId: 意图ID, digest, confirmedAt }`；`prepare`、令牌、摘要复核、`reconcile` 全部沿用。broker 侧只多一层校验和回执。

### 4.4 Chat 写入

确认完全由技能决定，与桌面版相同，客户端不加审批卡片。改动只在 `@oryh/dsh-host` 的 MCP 工具执行（`mcp-tools.ts`），服务器模式下对写入调用：

1. **本地判定**：工具是写工具，或 `oryh_request` 的方法不是 GET（校验除外）。
2. **附带写入描述**：`operation: { kind: 'chat', operationId: 新 UUID, sessionId, callId }` 后发出。同一次工具调用只发送一次；模型再次调用是新的一笔。
3. **结果交回模型**：
   - 成功、明确拒绝（ORYH 4xx）、结果不明分别以不同文字返回；
   - 结果不明时要求先用读取工具核对单据状态，不得重复写入；
   - broker 拒绝（不在开放清单）时说明原因。
4. **中间栏刷新**：沿用 M1 的写后刷新。

服务器版系统提示去掉 M1 的"目前只读"，恢复桌面版关于写入的规则（按技能确认、只执行用户明确要求的写入、以服务端返回为准）。

### 4.5 回执存储

控制进程在数据卷内用 SQLite（Node 24 内置 `node:sqlite`）保存，按 owner 分区：

| 字段 | 内容 |
| --- | --- |
| operation_id | 主键，去重依据 |
| owner、session_id、kind | 谁、在哪、页面还是 Chat |
| operation、method、path | 操作名与目标 |
| digest | 请求摘要（不存完整正文） |
| status | sent / succeeded / rejected / unknown |
| oryh_status、resource_id | ORYH 应答码与返回的单据 ID |
| confirmed_at（页面）、call_id（Chat） | 确认或发起的依据 |
| sent_at、finished_at | 时间 |

- 正文不落盘，只留摘要和 ORYH 返回的资源 ID，避免回执里堆业务数据。
- 控制进程重启后回执仍在，去重继续有效。
- 登录状态仍在内存，M4 再持久化。

### 4.6 结果不明的处理

- 页面：沿用各领域的 `reconcile`（已能按意图标识回查）。
- Chat：回执标为 `unknown`，模型收到"结果不明，先用读取工具核对单据状态，不要重复写入"。同一 `operationId` 永不重发；用户确认后的新写入是新 `operationId`，仍可能造成重复单据，由 ORYH 唯一约束和状态机兜底（例如同期间工时单已存在返回 409）。
- 真正消除重复需要 ORYH 支持幂等键（第 5 节）。

## 5. 需要 ORYH 配合的部分

| 内容 | 作用 | 没有时 |
| --- | --- | --- |
| 部署通用幂等中间件（开发中，见第 2 节）：客户端为每笔写入附一个唯一编号，ORYH 记住编号与结果，同编号重发时直接返回首次结果、不再执行 | 请求发出后没收到回复时，可以带同一编号安全重发，不会产生重复单据 | 不自动重发，结果不明时标"待核对"，由页面回查或 agent 读取后决定。broker 已为每笔写入附带操作 ID 作为幂等键（REST 用请求头，Chat 用 `idempotency_key` 参数），部署后即生效 |
| 首批操作的接口权限清单（谁能调用、校验什么） | 确认开放清单与 ORYH 权限一致 | 首批范围按现有技能和页面已验证的操作确定 |
| 写接口返回资源 ID 与版本 | 回执能定位单据，页面据此刷新 | 回读查询 |

## 6. 首批开放的写入

建议先开放页面已经验证过、ORYH 有状态机或唯一约束兜底的操作：

| 操作 | 接口 | 路径 |
| --- | --- | --- |
| 新建工时单 | `POST /timesheet-headers` | 页面、Chat |
| 整单保存工时 | `POST /timesheet-headers/{id}/save` | 页面、Chat |
| 增删改工时明细 | `POST/PATCH/DELETE /timesheet-entries…` | 页面、Chat |
| 提交工时单 | `POST /timesheet-headers/{id}/submit` | 页面、Chat |
| 审批工时 | `POST /approval-records`（`entity_type=timesheet_header`） | 页面、Chat |
| 新建、提交费用单 | `POST /expense-claims`、`POST /expense-claims/{id}/submit` | 页面、Chat |
| 上传费用附件 | `POST /attachments` | 页面（用户选择文件这一动作即确认；只生成未关联的文件，不产生业务事实） |
| 新建项目 | `POST /projects` | 页面、Chat |

- **清单位置**：清单是 broker 里"方法 + 路径模式 → 操作名"的登记表，也用于生成确认卡片上的操作名称。
- **以后扩展**：费用等其他单据的审批、订单、采购、库存、主数据等写入，按技能逐项验证后加入清单。
- **暂不开放**：Chat 里的 `upload_attachment`（模型提供文件内容，无法让人核对）。

## 7. 已确认的决策（2026-09-15）

1. **Chat 确认**：完全按技能，与桌面版一致；技能要求确认就在对话里确认，没有要求就不确认。
2. **首批范围**：按第 6 节。
3. **回执存储**：SQLite，放在数据卷内；外部数据库在 M4 再考虑。
4. **幂等键**：由 ORYH 决定是否提供，不阻塞 M2；在提供之前不自动重发。

## 8. 实施批次与验收

| 批次 | 内容 | 验收 |
| --- | --- | --- |
| A | `OryhRequest.operation`；broker 写入策略、操作登记表、SQLite 回执与去重 | 单元测试：无写入描述、页面摘要不符或过期、重复 operationId、不在清单均拒绝且未发出；2xx/4xx/超时分别记为 succeeded/rejected/unknown |
| B | 页面写入附带确认（工时、费用、项目） | 进程测试：页面确认后写入经 broker 放行；重复点击或重放不发送第二次 |
| C | Chat 写入附带写入描述与结果分类；服务器版提示词恢复写入规则 | 真实 Host + 替身模型：写入工具调用经 broker 放行并只发送一次；不在清单的写入被拒绝并说明；结果不明时模型收到"先核对、不重复写入" |
| D | 真实 ORYH（测试租户）端到端 | Chat 与页面各完成一次新建、提交工时和一次审批；刷新后中间栏状态一致；模拟断网得到"待核对"而不重发 |

后续（不在 M2）：幂等键就绪后的安全自动重发；回执在界面上的查看入口；按技能逐项扩大开放清单。

## 9. 实施记录

### 批次 A（2026-09-15）

- **core**：
  - `OryhRequest.operation`（`server-operation.ts`：页面带摘要与确认时间，Chat 带会话与工具调用）；
  - `operationDigest`（键顺序无关的规范化 JSON 摘要）；
  - IPC 逐字段校验写入描述，畸形描述在控制进程侧直接拒绝。
- **server-lab**：
  - `write-operations.ts`：第 6 节开放清单。按方法、路径、渠道匹配；`/approval-records` 只接受 `entity_type=timesheet_header`；附件上传只限页面。
  - `write-receipts.ts`：`SqliteReceiptStore`（`node:sqlite`，`<数据根>/control/receipts.sqlite`，目录权限 700，操作 ID 为主键，重启后仍去重）与测试用 `MemoryReceiptStore`。
  - `owner-broker.ts`：先把请求分为读或写。写入依次检查写入描述、页面摘要与 5 分钟有效期、开放清单，然后记回执、附幂等键发送，再按应答把回执定为 succeeded / rejected / unknown。
    - MCP 工具错误里带 ORYH `detail` 的算 rejected，其余算 unknown；
    - 一次 MCP 请求只允许一笔写入；
    - 没有配置回执存储时保持只读。
  - 控制服务：把回执存储交给每个 owner 的 broker。`control-main` 默认开启写入，`ORYH_WRITES=0` 回到只读。
- **效果**：owner Host 还没有附带写入描述（批次 B、C），此时的写入被拒绝为"缺少写入描述"，不会发出。
- **测试**：broker 写入 6 项、回执与清单 2 项、控制服务按 owner 记回执 1 项、core 摘要与 IPC 描述 2 项。

### 批次 B（2026-09-15）

- **写入描述移到 foundation**：`OryhOperation`、`canonicalJson`、`operationDigestInput`、`pageOperation` 移到 `@oryh/ai-client-foundation`，因为三个领域包和浏览器端都依赖它。SHA-256 由调用方用 `node:crypto` 计算，foundation 不引入 Node 模块。core 的 `operationDigest` 与领域服务用同一份规范化算法。
- **三个领域服务在用户确认后附带 `operation`**：
  - **工时** `timesheetConfirm`：操作 ID 为意图 ID，覆盖新建、整单保存、明细增删改、提交、审批；
  - **费用单** `expenseConfirm`：一张草稿先后产生新建和提交两笔写入，操作 ID 为 `草稿ID:动作:版本`；
  - **附件上传** `expenseUpload`：操作 ID 为每次随机生成，选择文件即确认；
  - **项目** `projectConfirm`：操作 ID 为 `意图ID:create`。
- **桌面版不受影响**：本地传输忽略 `operation`。
- **遗漏排查**：客户端里其余非 GET 请求只有设备授权、凭据刷新（仅桌面）、预校验（按读取放行）和 MCP 调用（批次 C）。
- **验收**（`server-lab/test/page-writes.test.ts`，服务器业务运行时直连 broker、模拟 ORYH）：
  - 工时确认后只发送一次，回执为 succeeded，幂等键即意图 ID；
  - 再次确认被领域状态机拒绝；原请求重放被 broker 以"已经发送过"拒绝，ORYH 只收到一次；
  - 费用单新建与附件上传、项目新建均经 broker 放行并记回执。

### 批次 C（2026-09-15）

- **core**：`OryhMcpClient.callTool` 接受 `{ operation }`，随 `/mcp` 请求一起送出。
- **dsh-host**：`mcp-tools.ts` 每次调用 ORYH 工具都附带 `{ kind: 'chat', operationId: 新 UUID, sessionId, callId }`。
  - broker 对读取忽略它，对写入据此放行、去重、记回执；桌面传输忽略它，因此不需要区分部署。
  - 确认与否完全按技能：客户端不加审批卡片，工具结果照原样交回模型。
  - broker 的拒绝（暂未开放、已经发送过）与"写入结果不明"以 `OryhClientError` 文字到达模型。
- **server-lab**：`startOwnerHost` 新增 `writes`，控制进程配置了回执存储时为 true。owner Host 的 Chat 因此不再带 M1 的"目前只读"规则，恢复桌面版写入规则（仍无 shell）。
- **验收**（`chat-writes.process.test.ts`，`ORYH_OWNER_HOST_TEST=1`）：真实 owner Host + 发起 `oryh_request` 的替身模型 + 真实 broker：
  - 新建项目只到达 ORYH 一次，回执带会话 ID 与工具调用 ID、状态 succeeded，模型收到 ORYH 返回；
  - `POST /purchase-orders` 被拒绝为"暂未开放"，ORYH 未收到；
  - ORYH 无应答时回执为 unknown，模型收到"写入结果不明……不要重复写入"；
  - 发给模型的请求中不再有"目前只读"。

### 批次 D 实测修正（2026-09-15）

用户在 Docker 服务器版登录测试环境后，在对话里新建并提交工时。ORYH 上只写入了一张工时（先建后提交，结果正确），但暴露了两个问题：

- **校验被记成写入**。agent 两次先校验再创建，把 `validate_only` 放在 `oryh_request` 的 `query` 对象里而不是 path 上。broker 只看 path，把这两次校验当成 `timesheet.create`：
  - 记了“成功”回执，resourceId 是 ORYH 校验时返回的临时 id（实际 `written:false`）；
  - 发送了幂等键。

  **修正**：path 查询串与工具 `query` 里的 `validate_only` 必须全部是 `true` 且至少出现一次，才按读处理；其他取值或两处不一致，按写入处理。已写入的两条错误回执留在库里，不影响使用。
- **中间栏停在“新建未保存”**。表单是 agent 用 `oryh_timesheet_propose` 填的，内容随后由 agent 在对话里写入 ORYH。agent 调 `oryh_open_timesheet` 打开新单时，页面因表单 dirty 拒绝替换，最终超时。

  **修正**：`oryh_open_timesheet` 新增 `discardDraft`。
  - Host 记录 agent 最后一次读取（`oryh_timesheet_read`）或填写并确认生效（`oryh_timesheet_propose`）时的表单快照。只有页面当前表单与快照完全相同，且没有明细正在编辑，才在导航命令里带上 `discardForm`；否则拒绝，并说明表单已被用户改动。
  - 页面收到命令时再比对一次：自己的表单仍等于 `discardForm`，且没有明细编辑或确认对话框，才放弃草稿并打开指定工时。
  - 提示词要求：按页面表单在对话里写入成功后，用 `discardDraft=true` 打开服务端单据。用户在页面上的修改仍受保护。桌面版同样适用。
