const KEY = 'carefind_recently_viewed'
const MAX = 8
export function pushRecent(id) {
  try {
    const cur = JSON.parse(localStorage.getItem(KEY) || '[]')
    const next = [id, ...cur.filter(x=>x!==id)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}
export function getRecent() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
