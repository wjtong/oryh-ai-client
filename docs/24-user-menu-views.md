# 用户自定义菜单项

2026-09-13。状态：已实施（分支 `user-menu-views`）。

用户可以在 Chat 里说"加一个菜单项叫入库单，对象是类型为入库的 Shipment"，左侧菜单随即出现「入库单」，点开是按服务端条件筛好的收发货列表。菜单项保存在该会话所在的 Harness workspace。

## 1. 一个菜单项是什么

一个菜单项是**已有列表 + 服务端筛选条件 + 用户起的名字**，不是新页面：

```ts
{ id, label: '入库单', kind: 'shipments', filters: { direction: 'inbound' } }
```

它不带来任何新权限。打开「入库单」和打开收发货列表需要同样的权限，行级授权照旧在服务端；ORYH 里把 `shipment.manage` 撤掉，这个菜单项和底下的列表一起消失。

对 Host 来说，菜单项所在的页面**就是它筛选的那个列表**（`page: 'shipments'`），菜单项本身放在 `context.view` 里。所以权限检查、`oryh_record_columns` 这些现有逻辑不用为它另写一套。

## 2. 筛选必须由服务端做

记录列表原来只向服务端发分页和一个搜索框字段，别的"筛选"都是在浏览器里过滤本页已载入的数据（页面上写着"筛选仅作用于本次载入数据"）。按这个方式做「入库单」是错的：超出第一页的记录会被悄悄漏掉，条数也不对。

所以 `RecordQuery` 加了 `filters`，由 `recordList` 作为查询参数发给 ORYH。实测证据：销售订单共 3 条（signed / shipped / confirmed），`status=shipped` 的菜单项显示「共 1 条」。这个总数是服务端的 `meta.total`；如果是浏览器里过滤，总数仍会显示 3。

## 3. 筛选字段对照部署的 OpenAPI 校验

FastAPI **会静默忽略没有声明的查询参数**。一个拼错的键，比如 `directon=inbound`，不会报错，而是返回全部记录——显示在一个名字说它已经筛过的菜单项下面。这是本功能最危险的失败方式，所以每个筛选键都要校验。

校验依据不是客户端里的一张表，而是**这个部署自己的 OpenAPI**：

- `OryhHttpClient.schema()` 取 `${origin}/openapi.json`。它挂在应用根路径而不是 `/api/v1` 下，是公开的，所以**不带 API key** 去取——key 只属于业务 API 调用。
- `ListParameters`（`packages/core/src/list-parameters.ts`）从文档里读出 `GET /api/v1/<list>` 声明的查询参数，去掉 `page`、`size`、`order_by`（分页和排序归列表本身管，不是菜单项定义的一部分），按连接缓存 10 分钟（约 1.4 MB，只在 ORYH 重新部署时变）。
- `RecordService.recordList` 对每个键核对：未声明的拒绝并列出可用字段；`boolean`/`integer`/`number` 按声明类型校验取值；同一个键不能既是搜索框又是筛选条件；**读不到 schema 时拒绝一切筛选**，因为不校验就发送，正是上面那个静默忽略的风险。

字段**取值**（例如 `direction` 是 `inbound` 还是 `outbound`）OpenAPI 里没有枚举，客户端也不写死。agent 按 ORYH 的 skill 与接口说明来定；取错值的后果是"0 条"而不是"全部"，这是可见、可纠正的失败。

## 4. 存在 Harness workspace 里

菜单项由 Host 保存在**会话所在的 Harness workspace** 中，经 `ctx.storageDomain` 写入名为 `oryh_user_views` 的存储域——和 Harness 自己的 workspace 注册表用的是同一种持久化形式，文件就在 DSH_HOME 的 `storages/oryh_user_views.json`，与 `storages/workspace.json` 并列。

- **不写进 workspace 的目录。** workspace 的路径对桌面用户来说就是他自己的项目目录（开发机上它就是本仓库），往里写应用数据是越界。
- **键是 workspace + 企业身份。** 会话属于哪个 workspace，由会话的 `cwd` 等于 workspace 路径决定（`workspaceRegistry.resolveByPath`）；同一个 workspace 对接两家企业时各有一份菜单，因为菜单项筛的是某家企业的列表。
- **按 workspace 分开是本设计的语义。** 切到另一个 workspace 里的会话，看到的是那个 workspace 的菜单。
- **Host 是唯一的写入方。** 页面不再保存副本，只镜像命令流里发布的 `userViews`（`user-view-bridge.tsx` → `user-views.ts`）。因此：重启服务、清空浏览器存储、换浏览器，菜单都还在；新增菜单项不需要页面在线回执。

实测：通过 Chat 加入「入库单」后，在清空浏览器 `oryh.views*` 键并重启服务进程的情况下，菜单项仍然出现并能打开；停留在「入库单」页面刷新，也不会在菜单列表到达前被错判为"已删除"而跳回我的待办（镜像区分"还没收到"和"没有"）。

早期版本把菜单项存在浏览器 localStorage。该分支未发布，旧数据**不做迁移**；实测环境里那一条已按新方式重建。

## 5. agent 工具

| 工具 | 作用 |
| --- | --- |
| `oryh_record_filter_fields` | 读某个列表在当前部署上能按哪些字段筛选。新增前先调用。只读 |
| `oryh_menu_add` | 新增菜单项。**先用这些条件读一次列表**再保存：读取本身就是校验（未声明的键在这一步被拒绝，什么都不会写入），并把条数告诉模型，0 条时提示用户核对取值。返回时已持久化 |
| `oryh_menu_remove` | 从 workspace 删除用户自己加的菜单项；若正打开着，页面在收到新列表后回到我的待办 |
| `oryh_open_view` | 打开用户自己加的菜单项，等页面回执。命令里带着它筛选的列表，页面同步时据此判断命令是否仍然有效 |

`oryh_current_page` 先从 workspace 读取最新菜单，再返回 `userMenu`，模型由此知道这些菜单项的名字。改菜单是个人显示偏好，不是业务写入，不需要确认对话框。

## 6. 刻意留下的限制

- **没有租户范围的定义。** "管理员为全租户定义菜单、用户在此之上覆盖"需要 ORYH 新增一个服务端资源，而 oryh 仓库不在本客户端的改动范围内。
- **只能建在已有列表之上**：销售订单、库存余额、库存流水、收发货。客户端里还没有列表页的对象（比如采购申请）暂时建不了。
- **只支持等值筛选**，能力等于该列表接口的查询参数。"或"、区间这类条件接口不支持就做不了。
- **会话不属于任何 workspace 时不能保存**，工具会明确报错。

内置菜单的名称仍然写死在客户端（菜单名来自 locale 字典，`en` 目前指向中文字典）。用户菜单项的名字是数据，不经过 locale，也不被翻译。

## 7. 查询栏的查询字段也改为读部署声明

同一个问题的另一处：列表查询栏"查询字段"原先写死，只有库存流水能加、只能加"产品"（`oryh_inventory_filters` 只接受 `product_code`，页面偏好的 schema 也用 `z.enum(['product_code'])` 限死）。用户说"查询字段，添加生效日期"时，agent 只能拒绝，还自己编了一句"建议在右侧页面自行筛选"——页面上并没有这种筛选。

现在：

- **可加的查询字段来自部署的 OpenAPI**，和菜单项用同一套 `recordFilterFields`，四个列表都适用。搜索框自己占用的字段不重复提供；库存流水另外保留客户端组合的"产品"查询。
- **字段取值作为服务端查询参数发送**。产品查询是逐个库存项向服务端取流水，其余查询字段一并带上，所以产品和其它字段可以同时用，结果仍由服务端筛选、总数准确。
- **`oryh_record_query` 取代 `oryh_inventory_filters`**。请求的字段不在接口声明里时，报错直接写明"ORYH 目前不支持按该字段查询"，并提示不要建议在页面上自行筛选；系统提示也改为同样的要求。
- 页面偏好只校验字段名的**格式**，不再校验字段是否"被允许"——那由部署决定，页面加载后按声明过滤。

实测（库存流水，10 条：issued 4、received 4、import_override 1、damaged 1）："查询字段，添加生效日期"——agent 列出接口实际声明的字段，回答"ORYH 目前不支持按生效日期筛选库存流水记录"，不再编造替代办法；"查询字段添加变动原因，查 received 的"——工具栏出现"变动原因"，结果共 4 条，全部为 received。

`GET /inventory-item-details` 目前没有日期参数。ORYH 已确认会增加日期区间参数；加上后它会自动出现在可加的查询字段里，客户端不需要改动。

修这处时还顺带去掉了一次重复请求：Chat 下发查询条件后，页面既因条件变化重新查询，又多触发了一次相同的刷新。

## 8. 落点

| 位置 | 变化 |
| --- | --- |
| `packages/core/src/http.ts` | `API_PREFIX`；`schema()` 不带 key 取 OpenAPI |
| `packages/core/src/list-parameters.ts` | 新增：从部署 schema 读出列表可筛选参数 |
| `packages/records/src/{contracts,service,inventory-product-query}.ts` | `RecordQuery.filters`；`recordFilterFields`；`checkedFilters` 校验后作为查询参数发送；产品查询同时带上其它查询字段 |
| `packages/dsh-host/src/user-views.ts` | 新增：`UserViewRegistry`，按 workspace + 企业身份存取，存储域 `oryh_user_views` |
| `packages/dsh-host/src/business-chat.ts` | 菜单四个工具；`addUserView`/`removeUserView`/`openUserView`；`refreshMenu`；命令快照发布 `userViews`；`configureQueryFields` 与 `oryh_record_query` |
| `packages/web/src/client/{user-views.ts,user-view-bridge.tsx}` | 页面侧镜像：从命令流接收菜单项，区分"未收到"与"没有" |
| `packages/web/src/client/{layout,layout-store,app,workbench,records,chat-navigation}.tsx` | `view:<id>` 页面、菜单渲染、`RecordPanel` 的 `view` 形态 |
