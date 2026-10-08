# dsh-prompt-refine

[![CI](https://github.com/liyuhan7/dsh-prompt-refine/actions/workflows/ci.yml/badge.svg)](https://github.com/liyuhan7/dsh-prompt-refine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

`dsh-prompt-refine` 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web Composer 的提示词优化插件。

它会在消息发送前，根据 Prompt Engineering 原则优化当前草稿或选中的文本，并将结果安全回填到 Composer。插件不会自动发送消息，最终 Prompt 始终由用户确认。

> **一行安装**
>
> ```bash
> dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine && dsh --profile web
> ```

## Features

- **一键优化**：直接优化 Composer 中的当前 Prompt。
- **局部优化**：存在文本选区时，只处理选中的纯文本。
- **`/refine` 命令**：支持 `/refine <正文>` 快速触发优化。
- **自适应 Prompt Engineering**：根据 Prompt 的完整程度和复杂度自动调整优化幅度。
- **实时差异预览**：全文优化后继续编辑，操作条持续同步草稿，并在输入停顿约 200ms 后刷新原文与当前内容的行内差异。
- **重新生成**：补充本次要求后，可基于原始 Prompt 重新生成。
- **安全回填与撤销**：防止过期结果覆盖已经编辑或提交的草稿。
- **沿用 DSH 模型配置**：使用当前会话、DSH 默认模型或插件备用模型完成优化。

## Installation

本插件包含 Web Composer UI，请安装到 `web` profile。

安装当前默认分支：

```bash
dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine
```

可从固定版本安装：

```bash
dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine#v0.1.3
```

安装或升级后重新启动 DSH Web：

```bash
dsh --profile web
```

确认插件已经进入配置：

```bash
dsh --profile web --dump-config
```

输出中应能找到 `dsh-prompt-refine`。

卸载：

```bash
dsh plugin --profile web remove dsh-prompt-refine
```

## Usage

在 Composer 中输入 Prompt，然后点击右侧的 **优化提示词**。

如果存在文本选区，插件只优化选中的纯文本；没有选区时，则优化当前可安全处理的草稿内容。

也可以使用：

```text
/refine 帮我检查这轮代码有没有问题
```

模型完整生成成功后，优化结果会一次性写回 Composer。随后可以继续编辑、补充要求重新生成、撤销本次优化或点击 **完成**。

插件不会自动发送消息。

## How it works

插件会根据原始 Prompt 的完整程度和复杂度，自适应改善：

`Intent · Context · Requirements · Method · Constraints · Output · Verification`

优化强度分为：

- **Clarify** — 对已经比较明确的 Prompt 做必要澄清；
- **Enhance** — 补充与原始目标直接相关的信息；
- **Structure** — 对复杂、多步骤或多约束 Prompt 进行适当结构化。

具体设计与示例见 [Prompt Refinement](./docs/prompt-refinement.md)。

## Documentation

- [Usage & Review](./docs/usage.md) — 局部优化、重新生成、撤销与 Diff Review
- [Prompt Refinement](./docs/prompt-refinement.md) — Prompt Engineering 策略与示例
- [Configuration](./docs/configuration.md) — 模型、参数与 fallback 配置
- [Security & Limitations](./docs/security-and-limitations.md) — 数据边界、安全机制与已知限制
- [Development](./docs/development.md) — 本地开发、CI、构建与 GitHub 分发
- [Error Messages](./docs/error-messages.md) — 错误和保护提示说明

## Compatibility

- DeepSeek Harness `^0.1.7-rc.2`
- DSH Web profile
- 浏览器支持 CSS Custom Highlight API 时可显示完整 Diff 标记

不支持 CSS Custom Highlight API 时，提示词优化与安全回填仍可正常使用，只是不显示差异标记。

## License

[MIT](./LICENSE)

---

Built for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).  
This is an independent community plugin.
