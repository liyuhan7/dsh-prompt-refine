# Configuration

本文说明 `dsh-prompt-refine` 的配置项、模型选择顺序和长期 Prompt 优化偏好。

## Options

| Option | Description | Default |
| --- | --- | --- |
| `enabled` | 是否启用提示词优化 | `true` |
| `fallbackProvider` | 当前会话和默认模型不可用时的备用 Provider | empty |
| `fallbackModel` | 与备用 Provider 配套的模型 | empty |
| `temperature` | 模型生成温度 | `0.3` |
| `maxOutputTokens` | 最大输出 token 数 | `2048` |
| `timeoutMs` | 单次模型调用超时 | `60000` |
| `maxInputChars` | 最大输入字符数 | `12000` |
| `customRules` | 长期 Prompt 优化偏好 | empty |
| `streaming` | 是否向前端发送流式预览 | `true` |

`fallbackProvider` 和 `fallbackModel` 应成对配置。

## Model Routing

模型选择顺序：

```text
当前会话选择
    ↓
DSH 全局默认模型
    ↓
插件备用模型
```

模型调用失败后不会自动切换到其他 Provider。

## Custom Rules

`customRules` 可用于保存长期 Prompt 优化偏好，例如：

```text
表达尽量简洁。
技术术语保留英文。
复杂任务优先使用分点结构。
避免无必要扩写。
```

这些规则作为用户级偏好参与每次优化，不会替代插件固定的 Prompt Engineering 策略。

## Additional Requirements

重新生成时可以输入本次额外要求，例如：

```text
这次重点强调测试覆盖范围，不需要展开实现步骤。
```

本次补充要求只影响当前重新生成，不会写入长期 `customRules`。
