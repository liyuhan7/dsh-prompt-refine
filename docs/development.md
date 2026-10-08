# Development

## Setup

```bash
git clone https://github.com/liyuhan7/dsh-prompt-refine.git
cd dsh-prompt-refine
npm install
```

## Tests

运行完整测试：

```bash
npm test
```

运行语法检查和测试：

```bash
npm run check
```

## Browser Bundle

重新构建浏览器 bundle：

```bash
npm run build
```

验证提交的 bundle 与源码一致：

```bash
npm run build:check
```

仓库会提交 `lib/client.bundle.js`，这样 DSH 从 GitHub 安装插件时可以直接加载浏览器产物，不需要用户额外执行构建步骤。

## GitHub Distribution

安装当前默认分支：

```bash
dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine
```

固定 Release Tag：

```bash
dsh plugin --profile web add github:liyuhan7/dsh-prompt-refine#v0.1.3
```

安装或升级后重新启动：

```bash
dsh --profile web
```

## Release Workflow

建议流程：

```text
完成开发
    ↓
npm run check
    ↓
npm run build:check
    ↓
更新 CHANGELOG
    ↓
更新 package.json version
    ↓
提交 commit
    ↓
创建 tag
    ↓
推送 GitHub
```

示例：

```bash
git tag v0.1.3
git push origin v0.1.3
```

## Continuous Integration

`.github/workflows/ci.yml` 在 Node 22 / 24 上执行主要门禁：

1. `npm ci`
2. JavaScript syntax checks
3. `npm run build:check`
4. `npm test`

## Project Structure

```text
lib/
├── index.js
├── client.js
├── client.bundle.js
├── strategy.js
├── prompt-validator.js
├── highlight-core.js
├── refinement-session.js
└── protocol.js

scripts/
└── build-client.js

test/

docs/
├── usage.md
├── prompt-refinement.md
├── configuration.md
├── security-and-limitations.md
├── development.md
└── error-messages.md

.github/workflows/
└── ci.yml

cordis.patch.yml
```

## Package Inspection

发布前建议检查：

```bash
npm pack --dry-run
```
