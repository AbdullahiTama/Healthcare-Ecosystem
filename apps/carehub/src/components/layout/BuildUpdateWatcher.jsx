import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BUILD_ID, fetchDeployedBuildId, isOutdated } from '../../lib/buildVersion'
import { theme } from '../../styles/theme'

const { navy, tealDeep } = theme

export const CHECK_INTERVAL_MS = 5 * 60 * 1000
const RELOAD_GUARD_KEY = 'carehub_build_reload_at'

function reloadOnce(reload) {
  // Offline, a reload would leave the device with no app at all.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0 } catch (e) {}
  // A deployment still propagating can briefly serve the old bundle with the
  // new version file; never reload in a loop because of it.
  if (Date.now() - last < 60000) return false
  try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())) } catch (e) {}
  console.warn('[app] a newer CareHub build is deployed; reloading to load it')
  reload()
  return true
}

// Notices when this device runs an older build than the one deployed and moves
// it onto the new one without losing anyone's work:
//   * at the next change of screen (whatever was being typed is being left
//     anyway), the page reloads;
//   * until then a banner offers "Reload now", so a dashboard left open at the
//     counter can be brought up to date by whoever is standing there.
// It never reloads in the middle of a screen on its own: a cashier halfway
// through a sale must not lose the cart (the cart already ends when the POS
// screen is left). Never while offline, where a reload would load nothing.
// Checks on start, every few minutes, and whenever the device comes back
// (tab shown again, connection restored). Off outside production builds.
export default function BuildUpdateWatcher({
  currentId = BUILD_ID,
  fetchDeployed = fetchDeployedBuildId,
  reload = () => window.location.reload(),
  intervalMs = CHECK_INTERVAL_MS,
}) {
  const [outdated, setOutdated] = useState(false)
  const location = useLocation()
  const firstPath = useRef(location.pathname)

  useEffect(() => {
    if (!currentId) return undefined
    let live = true
    const check = async () => {
      const deployed = await fetchDeployed()
      if (live && isOutdated(deployed, currentId)) setOutdated(true)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    check()
    const timer = setInterval(check, intervalMs)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
    }
  }, [currentId, fetchDeployed, intervalMs])

  useEffect(() => {
    if (location.pathname === firstPath.current) return
    firstPath.current = location.pathname
    if (outdated) reloadOnce(reload)
  }, [location.pathname, outdated, reload])

  if (!outdated) return null
  return (
    <div role='status' aria-live='polite'
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 1000, margin: '0 auto', maxWidth: 560,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: theme.radius.md, background: navy, color: 'white',
        fontSize: 13, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
      }}>
      <span>CareHub has been updated. Reload to get the latest figures and fixes.</span>
      <button type='button' onClick={() => reload()}
        style={{ padding: '7px 14px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
        Reload now
      </button>
    </div>
  )
}
