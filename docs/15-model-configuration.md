# 配置模型并开始聊天

模型配置复用 Harness 的 Models 设置页；ORYH 没有自己的模型请求客户端或密钥存储。

1. 点击左下角 **模型与设置**（图标模式为齿轮），进入 **Models / 模型**。
2. 已有提供方可点击 **Edit**：输入 API key，在 **Custom settings / 自定义设置** 中修改 Base URL 和模型目录，然后 **Apply**。页面的“API key configured”只表示凭据已配置，不代表连接测试成功。
3. 自建网关或未列出的提供方选择 **Add a custom provider**，填写 Provider ID、显示名、Base URL、API protocol、API key；点击 **Add model** 填写网关实际支持的 Model ID，也可通过 **Fetch available models** 获取目录。核对后点击 **Create provider**。Base URL、协议与 Model ID 必须采用服务商提供的值。
4. 关闭设置，点击聊天区 **Choose workspace** 在页面内目录对话框中选择或添加本机工作区。此处是 Harness 会话工作区，并非 ORYH 企业连接；仅登录企业不会自动选中它。
5. 在原生模型选择器中选择已配置模型，再输入消息发送。没有工作区时输入区提示 Choose workspace，发送不可用。

API key 通过 Harness 的 write-only credentials 接口保存；设置文档记录凭据引用，界面不会读回已保存的密钥。不要将 API key 写入聊天。可在原生设置中配置多个提供方及各自的模型。

普通模型对话与业务 AI 联动是两项能力。当前已开放企业/员工绑定的当前待办只读查询工具：在“我的待办”打开记录，等待“Chat 已关联当前待办”后询问。文件系统、shell、通用搜索与写入工具不开放。自动填写、提交费用表单尚未接入。

本机验证（2026-09-09）：通过页面内目录选择器选择当前项目工作区后，使用用户已经配置的 DeepSeek 提供方发送最小文本请求，收到「连接成功。」。未读取或修改保存的 API key，未执行业务工具。客户端构建、类型检查及 6 项客户端测试通过，resolved Profile 确认已挂载官方 browse Host/Client。
