function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function resolveValue(path, context) {
  const parts = path.trim().split('.')
  let val = context
  for (const part of parts) {
    if (val == null) return undefined
    val = val[part]
  }
  return val
}

function processConditionals(html, context) {
  const ifRegex = /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g
  let result = html
  let safety = 0
  while (/\{\{#if\s+[\w.]+\}\}/.test(result) && safety < 50) {
    result = result.replace(ifRegex, (_, varPath, trueBlock, falseBlock) => {
      const val = resolveValue(varPath, context)
      if (val) return trueBlock || ''
      return falseBlock || ''
    })
    safety++
  }
  return result
}

function processEachBlocks(html, context) {
  const eachRegex = /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g
  let result = html
  let safety = 0
  while (/\{\{#each\s+[\w.]+\}\}/.test(result) && safety < 50) {
    result = result.replace(eachRegex, (_, arrayPath, itemTemplate) => {
      const arr = resolveValue(arrayPath, context)
      if (!Array.isArray(arr)) return ''
      return arr.map((item, index) => {
        let rendered = itemTemplate
        const itemContext = typeof item === 'object' && item !== null ? item : { '.': item }
        rendered = rendered.replace(/\{\{this\}\}/g, escapeHtml(typeof item === 'object' ? JSON.stringify(item) : item))
        rendered = rendered.replace(/\{\{\{this\}\}\}/g, String(typeof item === 'object' ? JSON.stringify(item) : item))
        rendered = rendered.replace(/\{\{\.\/([\w.]+)\}\}/g, (__, key) => escapeHtml(resolveValue(key, itemContext) ?? ''))
        rendered = rendered.replace(/\{\{\{\.\/([\w.]+)\}\}\}/g, (__, key) => String(resolveValue(key, itemContext) ?? ''))
        rendered = rendered.replace(/\{\{@index\}\}/g, String(index))
        rendered = rendered.replace(/\{\{([\w.]+)\}\}/g, (__, key) => escapeHtml(resolveValue(key, itemContext) ?? resolveValue(key, context) ?? ''))
        rendered = rendered.replace(/\{\{\{([\w.]+)\}\}\}/g, (__, key) => String(resolveValue(key, itemContext) ?? resolveValue(key, context) ?? ''))
        rendered = processConditionals(rendered, { ...context, ...itemContext, '.': item })
        rendered = processEachBlocks(rendered, { ...context, [arrayPath.split('.').pop()]: arr })
        return rendered
      }).join('')
    })
    safety++
  }
  return result
}

export function renderEmailTemplate(htmlBody, variables) {
  if (!htmlBody) return ''
  const vars = variables || {}

  let result = htmlBody

  result = processConditionals(result, vars)
  result = processEachBlocks(result, vars)

  result = result.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, key) => {
    const val = resolveValue(key, vars)
    return val != null ? String(val) : ''
  })

  result = result.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = resolveValue(key, vars)
    return val != null ? escapeHtml(String(val)) : ''
  })

  return result
}

export function generateSampleVariables(variableDefs) {
  const sample = {}
  if (!Array.isArray(variableDefs)) return sample
  for (const v of variableDefs) {
    if (v.name) sample[v.name] = v.example || `[${v.name}]`
  }
  return sample
}
