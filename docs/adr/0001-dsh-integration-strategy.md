# ADR-0001：DSH 采用外部依赖与薄下游集成

状态：接受
日期：2026-08-19

## 背景

DeepSeek Harness 是预发布的插件式 Agent runtime，提供 Profile、Bundle、out-of-tree plugins、Agent/Session、工具、Skills、模型和 Web Client 扩展。ORYH 客户端需要这些能力，但 ORYH 的身份、业务工具、Skills、UI、安全和发布节奏属于独立产品。

直接在 DSH 官方 clone 或长期产品 fork 中开发会把 ORYH 业务代码与上游核心演进混合，并增加同步、审查和替换成本。完全不保留 fork 能力又会在上游缺少必要扩展点或紧急修复时阻塞产品。

## 决定

1. ORYH AI Client 使用独立仓库作为产品源码唯一归属。
2. DSH 通过精确版本的已发布包或经过固定 commit 构建的 runtime 被消费。
3. ORYH 能力实现为 out-of-tree plugins、一个 ORYH Bundle/Profile 和独立桌面组装。
4. 产品代码不导入 DSH 未公开 `src` 路径，不直接修改 agent loop。
5. 需要上游核心修改时创建 ORYH DSH fork，只维护最小通用补丁；产品业务代码仍不进入 fork。
6. 每个 fork patch 记录上游 issue/PR、使用原因、兼容范围和删除条件。
7. DSH 升级作为独立变更，执行完整契约、Snapshot、UI、安全和 E2E 门禁。

## 后果

正面：

- ORYH 产品边界清晰；
- 上游更新冲突更少；
- 更容易测试哪些是 DSH 能力、哪些是 ORYH 能力；
- 将来替换 Provider 或 runtime 的成本更可控；
- 通用改进可以回馈上游。

代价：

- 外部插件必须只依赖稳定公开扩展点；
- prerelease 版本升级仍可能需要适配；
- 本仓库需要自己的组装、发布和兼容测试；
- 缺少扩展点时需要协调上游或短期维护 fork。

## 未选择的方案

### 直接在官方 clone 的主分支开发

拒绝。会污染上游跟踪分支，也无法形成独立产品版本和发布边界。

### 把 DSH 完整复制进本仓库

拒绝。失去清晰上游历史，供应链和升级成本最大。

### 永久产品 fork，所有 ORYH 代码都在 fork 内

拒绝。虽然初期最方便，但长期冲突和耦合不可控，违背 DSH 插件架构的价值。

### 只使用 DSH Python SDK，不扩展 Web Client

不作为主方案。适合 Hosted Runner adapter 或自动化，但无法满足业务卡片、租户切换和桌面产品体验。

## 重新评估条件

- DSH 停止发布可消费包或删除关键外部扩展点；
- ORYH 必须修改 agent loop 才能满足不可协商的安全要求；
- 上游变更频率导致适配成本长期超过维护 fork；
- ORYH 改用另一 Agent runtime。
