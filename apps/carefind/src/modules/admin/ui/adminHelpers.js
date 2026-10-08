export function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (isNaN(diff)) return 'Unknown'
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 31536000) return `${Math.floor(diff / 86400)}d ago`
  return `${Math.floor(diff / 31536000)}y ago`
}

export function exportCSV(data, filename) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
