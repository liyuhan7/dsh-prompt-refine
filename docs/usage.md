# Usage & Review

本文说明 `dsh-prompt-refine` 的日常使用方式，包括 Composer 优化、局部优化、`/refine` 命令、重新生成、撤销和 Diff Review。

## Composer Refinement

1. 在 DSH Composer 中输入 Prompt。
2. 如果只希望优化部分内容，先选中对应文本。
3. 点击 **优化提示词**。
4. 等待模型完成生成。
5. 检查写回结果。
6. 根据需要重新生成、撤销或点击 **完成**。

插件不会自动发送消息，最终是否发送仍由用户决定。

## Selection Refinement

存在文本选区时，插件只处理被选中的纯文本。

如果选区跨越 DSH 的引用结构，插件会拒绝本次优化，以避免破坏引用占位信息。

## `/refine` Command

```text
/refine 帮我检查这轮代码有没有问题
```

插件只优化 `/refine` 后面的正文，命令前缀不会作为提示词内容发送给模型。

## Review and Regeneration

生成完成后可进行：

- **原文**：查看优化前 Prompt；
- **补充要求**：添加只对下一次生成生效的额外要求；
- **重新生成**：基于原始 Prompt 和当前补充要求重新生成；
- **停止生成**：终止当前尚未完成的请求；
- **撤销优化**：在草稿仍满足安全条件时恢复原始 Prompt；
- **完成**：结束本轮优化并清理 review 状态。

重新生成始终基于原始 Prompt，而不是上一轮生成结果：

```text
Original
├── Generate A
├── Regenerate + Note → B
└── Regenerate + Note → C
```

## Diff Review

插件会对优化后的结果进行行内差异标记：

- **绿色**：新增或扩写内容；
- **红色虚线**：局部替换内容；
- **纯删除**：不会重新插入已经不存在的原文。

Diff 只用于视觉 Review，不会改变最终 Prompt 正文。

## Manual Editing

优化结果写回后仍可继续手动编辑。

如果用户修改了当前草稿，部分依赖原始 revision 的能力可能失效，例如撤销、基于原选区重新生成或旧结果再次写回。这是为了避免插件覆盖用户后续输入。
