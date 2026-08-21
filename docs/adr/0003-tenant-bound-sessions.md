# ADR-0003：会话固定绑定一个租户

状态：接受
日期：2026-08-19

## 背景

ORYH 支持一个人在多个企业工作。通用 Agent 通过带企业命名空间的 Skill bundle 区分租户，但专属客户端还会持久化会话、加载动态 Skills、注册工具、缓存业务数据并管理多个 credential。如果在同一 Session 内切换全局“当前企业”，历史模型上下文和新凭据可能组合，产生错误企业写入或数据泄漏。

依靠模型理解用户说的是哪家公司不能形成安全边界。仅在 UI 顶部显示企业也不能阻止后台工具使用错误 connection。

## 决定

1. 每个 DSH Session 创建时绑定一个不可变 `ConnectionId` 和 ORYH tenant id。
2. Session 的 Agent scope、Skills、tools、context、API service、projection、cache 和 storage partition 都从该绑定派生。
3. 模型工具参数不能指定或覆盖 connection/tenant credential。
4. 全局企业切换器切换企业级首页和 Session namespace；它不会修改现有 Session。
5. 用户想在另一企业继续时，客户端创建或恢复另一企业 Session，并明确切换。
6. 缺少原 connection 的 Session 进入“连接缺失”状态，不选择默认租户。
7. MVP 不支持跨租户聚合。未来跨企业只读汇总需要独立只读聚合架构，不能放宽普通 Session 不变量。

## 后果

正面：

- 历史 context 与凭据保持同租户；
- Scope 可以结构性限制 Skill 和工具；
- Session replay 能恢复准确企业语义；
- 本地存储和删除可以按连接分区；
- 多企业误操作更容易通过测试证明不可发生。

代价：

- 用户不能在同一对话无缝让 Agent 操作两家公司；
- 企业切换需要会话导航和草稿处理；
- 相似工作可能形成多个会话；
- 未来跨企业个人摘要需要专门设计。

## 未选择的方案

### 全局 mutable current tenant

拒绝。会让旧 Session history 与新 token 相遇，错误恢复和后台任务也可能使用变化后的默认值。

### 每次工具调用由模型传 tenant id

拒绝。模型输出不可信，tenant id 不是授权，且容易受 prompt injection 和对象 id 混淆。

### 根据 Skill 名称选择企业

拒绝。名称可以陈旧、冲突或被租户自定义；权限应来自 connection credential 和 Session scope。

## 重新评估条件

普通读写 Session 的不变量不计划放宽。如果产品验证出强烈跨企业只读需求，应新增独立聚合 Session 类型，逐租户读取、明确标注来源、禁止写工具并进行单独安全评审。
