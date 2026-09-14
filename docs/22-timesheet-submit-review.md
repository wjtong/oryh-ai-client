# 提交前的规范核对（工时、费用及其它带流程定义的单据）

2026-09-12。状态：已实施（2026-09-12）。实施中修正了两处设计假设，见文末。

> **2026-09-14 修订（[ADR-0010](adr/0010-agent-is-the-primary-client.md)）：本文的闸门只作用于中间栏页面的提交按钮。** agent 是主客户端：在对话里提交时，agent 按 ORYH skill 读取流程定义并核对，发现不符合要求就不提交并说明，不再经过页面的核对对话框。

## 问题与决策

ORYH 的业务逻辑在 agent 层（Skills），因此像"每周 40 小时"这类**业务规范**不存在于代码里。中间栏传统界面的提交按钮不经过 agent，于是这类规范对它不起作用。

> 本文写作时 Chat 栏还没有装载 Skills，agent 只能读到服务端的流程定义。2026-09-12 起 Skills 已接通（[ADR-0009](adr/0009-chat-pane-is-a-generic-oryh-agent.md)、[Skills 装载](23-oryh-skills.md)），"规范来自 agent 读到的内容"这一前提因此才真正成立：租户管理员新发布的规范（实测 `HR-TM-001`，"每周不少于 30 小时"）会直接进入这道核对，客户端不改一行代码。

企业规范多数不是非黑即白——40 小时更接近"早上 10 点上班"：员工仍可能违反，靠审批等治理机制事后发现处理，而不是靠门禁拦住。

> **2026-09-12 修订：核对结论具有强制力。** 本文初版的目标是"不成为一条静默绕过的路径"，`flagged` 之后仍允许"仍然提交"。现改为：**agent 判定不通过，页面就不让提交**。
>
> 这不违背"规则不写进代码"——判断仍然完全来自 agent 读到的规范，代码里没有任何一条阈值；变的只是页面**执行**这个判定，而不是把它降级成一句提示。规范本身仍不是非黑即白，所以出口是**返回修改**或找管理员改规范，不是点"仍然提交"。
>
> 提交人依旧有 ORYH Console 和其它 agent 可走——被去掉的是"本客户端自己的核对可以被自己绕过"。

已决策：

- ~~**提交默认经过 agent 核对，但不是硬依赖。** 模型不可用、无会话或超时，仍可提交。~~ 已于 2026-09-12 改为**硬依赖**：只有 `passed` 才能提交，见上方修订。核对跑不起来时的出口是「重新核对」，不是放行。
- **核对跑在用户当前会话里。** 代价是聊天记录里会出现用户没有输入过的回合；收益是追问自然（"为什么说我超了"可以直接接着问）。
- **不记录"是否经过核对"**（该项暂缓）。服务端看不出一次提交是否经过本客户端的核对——绕过的方式不再是这个页面，而是 Console 或别的 agent。因此这道闸门约束的是**本客户端自己的提交路径**，仍不构成服务端层面的治理手段。
- **不把 40 小时写成代码。** 见 ADR-0008 之外的 ORYH 哲学：规则写进代码意味着每次调整都要走开发与发布周期。

界线：`validateTimesheet` 里现有的检查（一天不超过 24 小时、日期落在申报期间、明细条数上限）是**数据完整性不变量**，与企业政策无关，继续留在代码里。业务**规范**不进这个函数——尤其注意它已经在按天累加 `totals`，加一个按周累加只有三行，很容易顺手做错。

## 适用范围：带 workflow definition 的单据

判据是**服务端是否为这个 object_type 配了 workflow definition**，而不是单据长什么样。有定义就意味着企业对它有流程要求，页面上的提交按钮就不能绕过这些要求。

这条判据在运行时向服务端问，客户端里没有任何 object_type 白名单——这是一个通用 ORYH 客户端，不为某一个租户编译。每次提交前 `WorkflowDefinitions.governed(connectionId, objectType)` 查一次 `/workflow-definitions?object_type=…`：

- **查到定义** → 必须通过核对才能提交；
- **没有定义** → 这个租户对该单据没有流程要求，照常提交，不做多余拦截；
- **查询失败** → 按"有定义"处理。强制模式下"查不到"的安全答案是要求核对，否则一次网络抖动就把闸门悄悄关掉了，而那正是它要消除的绕过。

结果缓存 30 秒。窗口很短是有意的：租户管理员（或 agent）随时可能发布一条新定义，下一次提交就应该看见它。

下表是 2026-09-13 在某租户上的实测，用来说明覆盖面，**不是客户端里的列表**：

| object_type | 定义 | 本客户端能否提交 | 是否已接入核对 |
| --- | --- | --- | --- |
| `timesheet_header` | builtin v2 | 能 | ✅ |
| `expense_claim` | builtin v1 | 能 | ✅ |
| `purchase_request` | builtin v1 | **否——本客户端没有采购申请的提交界面** | 页面开放提交时自动适用 |
| `sales_order` | builtin v1 | 否（同上，只读查询） | 同上 |
| `sales_quotation` | builtin v1 | 否（同上，只读查询） | 同上 |
| `warranty_card`、3 × `rg_flow_*` | business_object | 否（本客户端不编辑自定义对象） | 同上 |

后四类今天不接入，不是因为它们被排除在机制之外，而是**这个客户端还没有提交它们的按钮**——没有提交动作，就没有要拦的东西。机制本身对 object_type 一视同仁。

给一个单据接上提交界面时，核对部分是三行样板，`SubmitReview` 不用改：

1. 在该领域的 contracts 里写出它的 object_type 常量（`TIMESHEET_OBJECT_TYPE` 那样，放 contracts 而不是 service，页面也要用，而 service 只能在 Node 跑）；
2. 该领域 service 暴露 `setSubmitGate()` 与 `setWorkflowLookup()`，在 `confirm()` 里权限检查之后先问 `governed()` 再调闸门；`index.ts` 的循环会把它接到 `reviews.assertPassed(objectType, documentId, sessionId)`；
3. 页面在准备提交时调用 `reviews.start(session,{objectType,documentId,label,read})`，把核对区渲染进确认对话框，并按 `norm.phase !== 'passed'` 禁用确认。

## 平台机制

核对不需要自建队列或轮询，Harness 的公开面已经覆盖：

| 能力 | 来源 |
| --- | --- |
| 向当前会话注入一个回合并唤醒空闲 driver | `agent.followup(message)` |
| 回合运行中时自动排队 | `followup` 排在当前回合之后，不打断 |
| 排队状态可观测 | `inbox` 是 durable 投影（`SessionProjectionMap.inbox`） |
| 回合生命周期 | `agent.status`、`agent.whenIdle()` |
| 取消 | `agent.cancel(cause, { keepInbox })` |

Host 已经持有 `ctx.agents`（`business-chat.ts` 在用）。**这意味着"会话里一次只能跑一个回合"不需要我们处理**：`followup` 若遇到回合在跑就排队等待。注意必须用 `followup` 而不是 `inbox.append`——后者只排队、不唤醒空闲 driver，见文末修正一。

## 结果如何回到界面

不要解析 agent 的自然语言结论。沿用本仓已有的"命令 + 回执"模式（`CommandQueue.issue` / `queue.wait`，导航与工时填写都在用）：

1. 用户点提交 → Host 发出一条 review 命令，并向 inbox 注入核对请求。
2. agent 完成判断后调用一个新工具报告结构化结论（通过 / 有问题 + 说明）。
3. 该工具调用**结算** `queue.wait`，界面据此切换状态。

`queue.wait` 自带 `timeoutMs`、`expired` 和 `invalid()` 判定，正好覆盖超时与"核对期间表单被改动则作废"。

## 状态机

点击提交后，核对对话框**立即打开**并显示整单内容（本地数据，零延迟）；核对状态显示在底部。

| 状态 | 条件 | 文案 | 确认按钮 |
| --- | --- | --- | --- |
| `queued` | 请求仍在 agent 的 inbox 里，前面还有会话回合 | 排队中，等待当前对话完成…（5 秒后追加已用时） | 禁用 |
| `reviewing` | 核对回合本身在跑 | 正在按企业工时流程要求核对…（同上） | 禁用 |
| `passed` | 工具回报通过 | 未发现与企业规范冲突 | **可用——只有这一种状态可用** |
| `flagged` | 工具回报有问题 | agent 的自然语言说明 + 无法提交，请返回修改 | 禁用 |
| `unavailable` | 无会话；**核对回合结束却没有回报结论**（模型报错、被取消）；120 秒兜底超时 | 无法完成核对，因此不能提交（附原因原文）+「重新核对」 | 禁用 |

- **核对必须有终局。** 回合可能带着结论一起死掉——实测一次模型配额耗尽（`Allocated quota exceeded`），回合 error 结束，没有任何工具回报，页面就停在"正在核对…"永远转下去。在强制模式下这不是慢，是死路。因此 `agent/error` 记下原因，`agent/status` 转 idle 时若核对回合已开始却未回报，就落 `unavailable` 并把原因原样显示；另有 120 秒兜底，覆盖既不回报也不转 idle 的情形。原因照抄底层报错：配额耗尽这种事只有用户能处理，写成"核对失败"等于什么都没说。
- **没有「跳过核对直接提交」。** 初版有这个按钮；留着它，`flagged` 的拦截就可以靠"在结论到达前先跳过"绕开，那道拦截也就等于不存在。取而代之的是 `unavailable` 状态下的「重新核对」，让用户有办法自己恢复，而不是有办法绕过。
- 文案要说明在核对**什么**，不要写"处理中"——"正在按企业工时规范核对"本身就在告知用户存在这道规范。
- `reviewing` 期间锁定表单；用户改动（现有 `dirty`）即作废结果并要求重新核对。
- 无会话是既有状态，`timesheet-chat.tsx` 已有「请先在 Chat 中选择或创建一个会话」。此时**不自动建会话**，直接落 `unavailable`。

## 注入消息的写法

它是一条真实的 `UserMessage`，会渲染成用户消息，所以必须自述来源：

> （提交动作触发）请按企业工时规范核对当前工时单。

## 落点

| 位置 | 变化 |
| --- | --- |
| `packages/web/src/client/timesheets.tsx` | 提交按钮改为先开对话框并进入核对态；五个核对状态，只有 `passed` 解禁确认；`unavailable` 提供「重新核对」 |
| `packages/core/src/workflow.ts` | `WorkflowDefinitions`：这个租户把哪些 object_type 纳入了流程，唯一决定要不要核对的地方 |
| `packages/dsh-host/src/submit-review.ts` | 与单据无关的核对本体：注入 inbox、`oryh_review_result` 结论工具、失败与超时的终局、`assertPassed` 闸门 |
| `packages/dsh-host/src/timesheet-chat.ts` | 只保留工时自己的页面绑定与权限检查，核对委托给 `SubmitReview` |
| `packages/web/src/client/expenses.tsx` | 费用申请提交走同一套：核对区、只有 `passed` 解禁确认、`unavailable` 提供「重新核对」 |
| `packages/dsh-host/src/command-queue.ts` | 复用，无需改动 |
| `packages/timesheets/src/contracts.ts` | **不改**——规范不进 `validateTimesheet` |
| `packages/timesheets/src/service.ts` | `setSubmitGate()`：Host 注入的确认闸门，`confirm()` 在权限检查之后调用 |
| `packages/expenses/src/service.ts` | 同样的 `setSubmitGate()`，只在 `action==='submit'` 时调用 |

## 已知代价与未决项

- **聊天记录污染**：每次提交都会在会话里增加一个回合，并增长上下文。除非给 Harness 增加一种消息类型，否则无解；那超出"只用公开扩展点"的边界。
- **绕过不可见**：见上文决策，暂缓项。
- **注入机制已验证**：见下两节。

## 最小验证结果（2026-09-12）

在真实客户端上验证了注入机制，临时探针已删除（Host 侧一个 `@Remote`、客户端两行 window 暴露、一个临时启动脚本、一个临时依赖，全部已还原）。

方法：临时给 Host 加一个 Remote，调用 `ctx.agents.get(sessionId)` 后 `agent.inbox.append('next-turn', createUserMessage(...))`，并回报调用前后的 `agent.status` 与 `inbox.nextTurn.length`。为不影响另一个正在运行的客户端，探针跑在 4174 端口的独立实例上。

**关键一步是在回合运行中注入**，这正是设计所依赖的情形：

```json
{"statusBefore":"running","statusAfter":"running","pendingBefore":0,"pendingAfter":1}
```

随后会话记录显示了完整的三步：

```
[第 1 轮回复] …您现在正在"我的待办"页面…      Ran for 13s
（提交动作触发）请回复"核对测试已收到"。        ← 注入的消息
核对测试已收到。                              Ran for 1s
```

结论：

| 问题 | 结果 |
| --- | --- |
| Host 插件能否向当前会话注入回合 | 能，`ctx.agents.get()` → 注入（实施时改用 `followup`，见修正一） |
| 回合运行中注入会不会打断或竞争 | 不会，`status` 保持 `running`，消息进入待处理队列 |
| 排队的消息会不会被消费 | 会，当前回合结束后自动作为下一回合执行 |
| 是否可见、可追问 | 是，渲染为用户消息，agent 正常回复 |

因此 `queued` 状态不需要自建队列，直接反映 `inbox` 即可；文档前面关于"平台已解决并发"的判断成立。

一并确认的实现细节：构造消息需要 `createUserMessage`（来自 `@deepseek-ai/dsh-llm`，`dsh-session` 只重导出类型不导出工厂），`OryhRemote` 的 `static inject` 需加 `'agents'`。实施时这两项要正式加回。
- 核对耗时分布未知。本次会话中工时相关回合实测 6–24 秒，纯核对应更短，但需要真实数据再决定 15 秒阈值是否合适。


## 实施记录（2026-09-12）

已按本文实施并在真实客户端跑通：点提交 → 对话框立即打开显示整单 → 底部「正在按企业工时流程要求核对…」且确认按钮禁用 → agent 读取实际内容后回报结论 → 显示「未发现与企业工时流程要求冲突。」且确认按钮解禁。实测用 40 小时的草稿单，全程只核对未确认，没有向租户写入。

落点与设计一致：`timesheet-chat.ts` 持有 review 状态、注入请求、注册结论工具；状态经既有命令流发布（`CommandSnapshot.review`）；`timesheets.tsx` 在既有核对对话框内增加核对区并据此禁用确认。`validateTimesheet` 未改动。

### 修正一：`inbox.append` 不会唤醒空闲 agent

前一次最小验证只测了「回合运行中注入」——那种情况下队列本来就会被排空，所以看起来成功。**空闲时注入（点提交的常见情形）消息会一直躺在会话里，永远不会触发回合。**第一次真机联调就卡在这里：注入的消息出现在聊天里，但 agent 没有任何反应。

正确的 API 是 `agent.followup(message)`：文档明确写着「queue an ordinary follow-up turn **and wake the driver**」，既能排在运行中的回合之后，也能唤醒空闲的 driver。已改用它，并在测试里把假 agent 的 `inbox.append` 做成抛错，防止再退回旧写法。

教训记在这里：上次那句「机制已验证」把**排队路径**的验证当成了**全部路径**的验证。两条路径要分别测。

### 修正二：新工具必须加进 ORYH 的工具白名单

`business-chat.ts` 有一份 `toolNames` 白名单，通过 `agent.ctx.tools.restrict({allow:toolNames})` 收窄每个 agent 可见的工具（ADR-0007 的"窄业务 Tool catalog"）。`ctx.tools.register` 注册成功不等于模型看得见。

第二次联调时 agent 读完工时、写出了一份正确的核对报告，却说「oryh_timesheet_review_result 并非我当前可用的工具」——注册在 Host 上，但被白名单挡住。加进 `toolNames` 后即通。`tests/index.spec.ts` 里有一条断言精确锁定这份白名单，改动会让它失败，这是有意的守卫，不要绕过。

### 仍未做

- ~~取消语义~~：随「跳过核对」一起移除，见上方状态机说明。用户关闭对话框时 `reviewClear` 丢弃结论，进行中的那次核对仍会跑完——浪费一次模型调用，不影响正确性。
- **计时阈值**：5 秒开始显示已用时，是拍的；实测核对约 15 秒，需要更多样本再定。既然没有跳过按钮，这个阈值现在只影响文案。

### 追加：`queued` 与 `reviewing` 已分开（2026-09-12）

实测三态转换在真实客户端出现：`queued` → `reviewing` → `passed`。

判据不是 agent 的状态本身，而是**注入的请求是否还在 inbox 里**：在里面说明前面还有会话回合，离开了说明核对回合已经开始。

只订阅 `agent/status` 不够——实测发现 idle → running 这次事件**发生在 driver 清空 inbox 之前**，此刻请求看上去仍在排队，而在结论回来之前不会再有下一次状态事件，结果就是状态卡在 `queued` 直接跳到 `passed`。所以真正的信号取自核对回合的第一步：请求里要求 agent 先调用 `oryh_timesheet_read`，该工具执行时把 `queued` 翻成 `reviewing`。

代价是一个很窄的误报窗口：如果挡在前面的那个会话回合恰好也读了工时，标签会提前翻成 `reviewing`。它只影响文案，不影响确认按钮的启用条件，因此可以接受。已在注释和测试里写明。
