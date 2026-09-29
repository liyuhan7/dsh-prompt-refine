import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildClientBundle } from '../scripts/build-client.js'
import { diffHunks } from '../lib/highlight-core.js'

test('the shipped client bundle is generated from the unique engine and renderer sources', () => {
  const bundle = readFileSync(new URL('../lib/client.bundle.js', import.meta.url), 'utf8')
  assert.equal(bundle, buildClientBundle())
  const core = readFileSync(new URL('../lib/highlight-core.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(core, /\b(?:CSS|document|red|green|maxCells|Uint16Array|backtracking)\b/u)
  assert.doesNotMatch(client, /maxCells|Uint16Array|backtracking|function computeTextDiff|function diffHunks/u)
  let exports
  vm.runInNewContext(bundle, { window: { __ModuleLoader__: { load: ({ factory }) => { exports = factory(id => {
    assert.equal(id, 'react', 'the browser must not depend on external diff or local ESM loading')
    return {}
  }) } } } })
  const renderer = exports.createHighlightCore()
  for (const [original, result] of [
    ['帮我检查代码', '帮我检查当前代码'], ['A😀B', 'A😀测试B'],
    ['解释一下这个函数', '分析当前函数的职责、输入输出、关键执行路径和边界行为，并说明验证结果。']
  ]) assert.deepEqual(JSON.parse(JSON.stringify(renderer.diffHunks(original, result))), diffHunks(original, result))
})
