/** 空结果和长度超限阻止回填；可能过度扩写仅作为警告。 */
export function validateOptimizedPrompt(original, result) {
  const issues = []
  const source = String(original ?? '').trim()
  const output = String(result ?? '').trim()

  if (!output) {
    issues.push({ code: 'empty-output', severity: 'error' })
    return { valid: false, issues }
  }
  if (output.length > 12000) issues.push({ code: 'output-too-long', severity: 'error' })
  if (source.length <= 50 && output.length >= 1000) {
    issues.push({ code: 'possible-over-expansion', severity: 'warning' })
  }
  return { valid: !issues.some(issue => issue.severity === 'error'), issues }
}
