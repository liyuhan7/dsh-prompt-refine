<<<<<<< HEAD
# dsh-prompt-refine
=======
# dsh-prompt-refine

[![CI](https://github.com/liyuhan7/dsh-prompt-refine/actions/workflows/ci.yml/badge.svg)](https://github.com/liyuhan7/dsh-prompt-refine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

`dsh-prompt-refine` 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web Composer 的提示词优化插件。

它会在消息发送前，对当前草稿或选中的纯文本进行 Prompt Engineering 优化，并把结果安全回填到原输入框中。插件不会自动发送消息，也不会读取会话历史、附件或工作区文件。

> **一行安装**（需要先装好 DSH Web）：
>
> ```bash
> dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine && dsh --profile web
> ```
>
> 装完重启 DSH Web，输入框右侧就会出现「优化提示词」按钮。详见 [Installation](#installation)。

## Features

- **一键优化提示词**：在 Composer 中直接优化当前草稿。
- **局部优化**：存在文本选区时，只优化选中的纯文本。
- **`/refine` 命令**：支持通过 `/refine <正文>` 直接优化命令后的内容。
- **自适应 Prompt Engineering**：根据输入复杂度调整优化强度，重点改善 Intent、Context、Requirements、Method、Constraints、Output 和 Verification。
- **差异预览**：对优化结果中的新增和局部替换进行行内标记，方便快速检查改动。
- **重新生成**：可以补充本次要求后重新生成；每次都从原始 Prompt 开始，避免连续改写导致语义漂移。
- **安全回填**：生成期间不修改输入框，只有模型完整成功结束后才一次性写回；草稿被编辑或提交后会阻止过期结果覆盖当前内容。
- **撤销与完成**：支持恢复优化前原文，并在确认后关闭本次优化面板。
- **沿用 DSH 模型配置**：优先使用当前会话选择的模型，其次使用 DSH 默认模型，最后才使用插件配置的备用模型。

## Installation

本插件包含 Web Composer UI，请安装到 `web` profile。

### Install from GitHub

推荐固定到 Release Tag，避免上游改动直接影响你的环境：

下面的固定版本命令在仓库发布 `v0.1.0` 标签后可用；标签发布前可使用默认分支安装命令。

```bash
dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine#v0.1.0
```

也可以跟踪 `main` 分支的最新提交（不推荐用于日常使用）：

```bash
dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine
```

> **关于 git 安装：** DSH 用 pnpm 从 git 拉取源码。本仓库已提交构建好的
> `lib/client.bundle.js`，因此**不需要 `prepare` 构建步骤**。若 pnpm 提示需要
> 授权构建脚本，按提示把对应 key 加到 profile 的 `pnpm-workspace.yaml` 的
> `allowBuilds` 下即可。

安装或升级后重新启动 DSH Web：

```bash
dsh --profile web
```

可以通过下面的命令确认 bundle 已进入 `web` profile：

```bash
dsh --profile web --dump-config
```

输出中应能找到 `dsh-prompt-refine`。

### Uninstall

```bash
dsh plugin --profile web remove dsh-prompt-refine
```

## Usage

### Composer button

1. 在 DSH Composer 中输入 Prompt。
2. 如果只希望优化其中一部分，先选中对应的纯文本。
3. 点击输入框右侧的 **优化提示词**。
4. 等待模型完成优化。
5. 结果会写回原输入框，并显示本轮优化操作条。
6. 检查结果后，可以继续编辑、重新生成、撤销优化或点击 **完成**。

插件不会自动发送消息，最终是否发送仍由用户决定。

### `/refine` command

也可以直接输入：

```text
/refine 帮我检查这轮代码有没有问题
```

执行后只会优化 `/refine` 后面的正文，命令前缀不会作为提示词内容发送给模型。

## Prompt Refinement

插件会根据原始 Prompt 的完整程度和复杂度，自适应决定优化幅度。

优化时会在需要的情况下考虑以下维度：

- **Intent** — 用户真正希望 Agent 完成什么；
- **Context** — Agent 应利用哪些已有代码、文件、变更或上下文；
- **Requirements** — 完成任务时需要关注哪些关键要求；
- **Method** — 哪些分析方法、执行方式或顺序有助于提高结果质量；
- **Constraints** — 范围、兼容性、修改边界和其他限制；
- **Output** — 最终希望 Agent 产出什么；
- **Verification** — 如何确认任务结果符合原始目标。

优化强度分为三类：

- **Clarify**：对已经较明确的 Prompt 做必要澄清；
- **Enhance**：补充与原始意图直接相关的上下文、要求、方法和结果预期；
- **Structure**：对复杂、多步骤、多约束的 Prompt 进行适当结构化。

插件会保留原始 Prompt 的主要语言，并尽量避免猜测未知的项目事实。对于具体实现依赖当前项目实际情况的内容，会使用“结合当前实现”“沿用项目现有方式”等上下文适应性表达。

## Example

### Before

```text
给这次修改写点测试，看看有没有问题
```

### After

```text
针对本次实际代码修改补充并运行相关测试。先结合代码变更、受影响的功能和项目现有测试方式确定需要验证的范围，再编写能够覆盖主要执行路径、关键边界情况、异常路径以及可能回归行为的测试。优先沿用项目已有测试框架和组织方式。完成后运行新增测试及与本次修改直接相关的现有测试，并说明测试覆盖了哪些行为、发现了哪些问题以及最终验证结果。
```

## Review and Regeneration

生成完成后，Composer 内会出现本轮优化操作条：

- **原文**：查看本轮优化前的 Prompt；
- **补充要求**：输入只对下一次重新生成生效的额外要求；
- **重新生成**：基于原始 Prompt 和当前补充要求重新生成；
- **停止生成**：终止当前尚未完成的请求；
- **撤销优化**：在草稿仍满足安全条件时恢复原始 Prompt；
- **完成**：结束本轮优化并清理改动标记。

重新生成不会基于上一次优化结果继续改写，而是始终从原始 Prompt 开始。

## Diff Review

插件会对优化后的结果进行行内差异标记：

- **绿色**：新增内容或扩写内容；
- **红色虚线**：与原文长度相近的局部替换；
- **未标记删除**：纯删除的原文已经不在结果文本中，因此不会在 Composer 内额外插入删除文字。

差异标记只用于 review，不会向 Prompt 中插入额外字符，也不会修改宿主编辑器 DOM 结构。

## Configuration

插件提供以下可热更新设置：

| Option | Description | Default |
| --- | --- | --- |
| `enabled` | 是否启用提示词优化 | `true` |
| `fallbackProvider` | 当前会话和默认模型不可用时的备用 Provider | empty |
| `fallbackModel` | 与备用 Provider 配套的模型 | empty |
| `temperature` | 模型生成温度 | `0.3` |
| `maxOutputTokens` | 最大输出 token 数 | `2048` |
| `timeoutMs` | 单次模型调用超时 | `60000` |
| `maxInputChars` | 最大输入字符数 | `12000` |
| `customRules` | 长期提示词优化偏好 | empty |
| `streaming` | 是否向前端发送流式预览 | `true` |

`fallbackProvider` 和 `fallbackModel` 应成对配置。

## Model Routing

模型选择顺序为：

```text
当前会话选择
    ↓
DSH 全局默认模型
    ↓
插件备用模型
```

模型调用失败后不会自动切换到其他 Provider。

## Data Boundary

本插件只处理当前 Composer 中需要优化的纯文本。

插件本身：

- 不读取会话历史；
- 不读取附件；
- 不读取工作区文件；
- 不自动发送优化后的 Prompt；
- 不向独立的第三方服务上传数据。

触发优化时，待优化文本、插件的 Prompt Engineering 指令以及本次补充要求会被发送给 DSH 当前使用的模型 Provider。涉及敏感信息时，请同时遵循对应模型 Provider 的数据与隐私政策。

插件的 Host API 只接受本机同源请求，并拒绝跨站和带转发来源的请求。

## Compatibility

插件声明支持以下环境，当前本机检查使用 DSH `0.1.7-rc.2`；后续版本仍需实际验收：

- DeepSeek Harness: `^0.1.7-rc.2`
- Web profile
- Node.js / runtime requirements follow the installed DSH version

差异标记需要浏览器支持 CSS Custom Highlight API。不支持时优化与回填照常工作，只是不显示差异标记。

## Known Limitations

- 无选区时，如果草稿包含引用或命令，插件不会直接做全文优化；请先选中需要处理的纯文本段。
- 选区覆盖 `@引用` 时会拒绝优化，避免破坏 DSH 的引用占位结构。
- 重新生成只针对原始选区；如果已经手动编辑优化结果，请完成当前优化后重新开始。
- 浏览器不支持 CSS Custom Highlight、文本映射不确定或文本过长时，可能不显示差异标记，但不会影响安全回填结果。
- 纯删除不会在 Composer 中额外显示被删除的原文。

## Development

Clone the repository and install dependencies:

运行构建和测试需要 Node.js 22.15 或更高版本；这一要求用于开发检查，插件运行环境由 DSH 决定。

```bash
git clone https://github.com/liyuhan7/dsh-prompt-refine.git
cd dsh-prompt-refine
npm install
```

Run the full test suite:

```bash
npm test
```

Run syntax checks and tests:

```bash
npm run check
```

Rebuild the browser bundle:

```bash
npm run build
```

Verify that the committed browser bundle is up to date:

```bash
npm run build:check
```

Before creating a release package:

```bash
npm pack --dry-run
```

The GitHub-installable repository includes the built browser entry `lib/client.bundle.js`, so users do not need to build the plugin manually after installation.

### Continuous integration

`.github/workflows/ci.yml` 在 Node 22 / 24 上跑同一套门禁：

1. `npm ci` — 依赖可复现安装；
2. 逐个执行 `node --check` — 检查 `lib/` 和 `scripts/` 中的 JavaScript 文件；
3. `npm run build:check` — **确认入库的 `lib/client.bundle.js` 与源码一致**；
4. `npm test` — 全部用例。

## Project Structure

```text
lib/
├── index.js              # Host plugin and model endpoint
├── client.js             # Composer integration and UI
├── client.bundle.js      # Browser distribution bundle (committed)
├── strategy.js           # Prompt Engineering strategy and few-shot examples
├── prompt-validator.js   # Optimized prompt output validation
├── highlight-core.js     # Diff Engine
└── protocol.js           # Request / response helpers

scripts/
└── build-client.js       # Browser bundle build script

test/                     # Unit and regression tests
docs/
└── error-messages.md     # Error and guard message reference
.github/workflows/ci.yml  # CI: 语法检查 → 产物一致性 → 测试
cordis.patch.yml          # DSH bundle configuration layer
```

`lib/client.bundle.js` is committed on purpose: GitHub installs receive a
ready-to-load browser entry and never run a build step.

## License

[MIT](./LICENSE)

---

Built for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This is an independent community plugin.
>>>>>>> 3883dd4 (feat: dsh-prompt-refine v0.1.0 首个版本)
