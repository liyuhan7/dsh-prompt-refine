# Security and Limitations

## Data Boundary

插件只处理当前 Composer 中需要优化的纯文本。

插件不会主动读取：

- 会话历史；
- 附件；
- 工作区文件。

插件不会自动发送优化后的 Prompt。

触发优化时，下列内容会发送给 DSH 当前使用的模型 Provider：

- 待优化文本；
- Prompt Engineering 指令；
- 本次补充要求；
- 用户配置的长期优化偏好。

插件本身不会把数据发送到独立的第三方服务。

## Safe Write-back

模型生成期间不会修改 Composer。

只有模型完整成功结束，并且 Composer 仍然满足原始安全条件时，结果才会一次性写回。

如果生成过程中出现以下情况：

- 用户修改了草稿；
- 草稿已经提交；
- Composer revision 发生变化；
- 引用状态发生变化；
- 原选区已经无法可靠定位；

插件会阻止旧结果覆盖当前内容。

## References

如果选区覆盖 DSH 的引用结构，插件会拒绝本次优化，避免破坏引用占位信息。

## Undo Safety

撤销不会无条件覆盖当前草稿。

只有当前 Composer 仍然与插件记录的优化结果保持一致时，才允许恢复原始 Prompt。

## Known Limitations

- 带引用或命令的复杂全文草稿可能需要先选择纯文本区域；
- 选区覆盖 DSH 引用时会拒绝优化；
- 重新生成始终针对原始 Prompt 或原始选区；
- 手动修改结果后，部分撤销或重新生成能力可能失效；
- 浏览器不支持 CSS Custom Highlight API 时不会显示 Diff；
- 文本映射不确定或文本过长时可能跳过 Diff；
- 纯删除不会在 Composer 中额外显示被删除的原文；
- 模型调用失败后不会自动切换到其他 Provider。
