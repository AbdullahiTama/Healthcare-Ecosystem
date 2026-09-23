export async function callAdminAuth(action, payload = {}) {
  try {
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  } catch (err) {
    console.error(`[callAdminAuth] ${action} failed:`, err.message)
    throw new Error(err.message || 'Network error — check if the admin API is reachable')
  }
}
