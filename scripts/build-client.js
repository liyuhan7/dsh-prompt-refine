import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const outputUrl = new URL('../lib/client.bundle.js', import.meta.url)

export function buildClientBundle() {
  const diffPackageUrl = pathToFileURL(require.resolve('diff/package.json'))
  const pkg = JSON.parse(readFileSync(diffPackageUrl, 'utf8'))
  const vendor = readFileSync(new URL(pkg.browser, diffPackageUrl), 'utf8')
  const license = readFileSync(new URL('./LICENSE', diffPackageUrl), 'utf8')
  // 将 jsdiff 浏览器构建、差异适配器和客户端源码组装为 DSH 的延迟加载模块。
  const core = readFileSync(new URL('../lib/highlight-core.js', import.meta.url), 'utf8')
    .replace("import { diffArrays, diffChars } from 'diff'", 'const { diffArrays, diffChars } = diffLibrary')
    .replace(/^export /gm, '')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    .replace("import * as diffEngine from './highlight-core.js'", '')
  // 分发产物保留 jsdiff 的原始许可证声明。
  return `// 本文件由 npm run build 自动生成，请修改 client.js 或 highlight-core.js 后重新构建。
/* jsdiff ${pkg.version} — BSD-3-Clause\n${license}*/
(() => {
  const diffLibrary = (() => {
    const module = { exports: {} }
    const exports = module.exports;
${vendor}
    return module.exports
  })()
  const diffEngine = (() => {
${core}
    return { computeTextDiff, classifyDiffMagnitude, diffSegments, segmentsToHunks, diffHunks, diffRanges }
  })()
${client}
})()
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bundle = buildClientBundle()
  if (process.argv.includes('--check')) {
    if (readFileSync(outputUrl, 'utf8') !== bundle) throw Error('Stale client bundle; run npm run build')
  } else writeFileSync(outputUrl, bundle)
}
