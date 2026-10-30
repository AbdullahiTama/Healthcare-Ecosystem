import { useState, useEffect } from 'react'
import { authClient } from '../../lib/authClient'
import { clockSkewMs } from '../../lib/sessionFetch'
import { theme } from '../../styles/theme'

const { warning, warningBg } = theme

// Beyond normal drift, well short of anything that confuses the session.
const BEHIND_THRESHOLD_MS = 5 * 60 * 1000

export function describeLag(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 90) return `about ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return `about ${hours} hour${hours === 1 ? '' : 's'}`
}

// A till whose clock runs behind was what kept "falling asleep" after an hour:
// supabase-js judged the expired token valid by the device clock and never
// renewed it. lib/sessionFetch.js now renews on the server's word, so staff
// stay signed in either way. This banner exists because the clock is still
// wrong for everything else on the device, and only someone at the device can
// fix that. Reads the clock from each token the server mints; see clockSkewMs
// for why only a clock running behind is reported.
export default function ClockSkewBanner() {
  const [behindMs, setBehindMs] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const { data } = authClient.auth.onAuthStateChange((event, session) => {
      if (!session) return
      const skew = clockSkewMs(session)
      if (skew < -BEHIND_THRESHOLD_MS) {
        console.warn('[session] device clock is behind the server by', Math.round(-skew / 1000), 'seconds')
        setBehindMs(-skew)
      } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        // A freshly minted token reflects the clock as it is now, so it can
        // also clear the warning once someone fixes the clock.
        setBehindMs(0)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!behindMs || dismissed) return null

  return (
    <div
      role='status'
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap',
        padding: '8px 20px', fontSize: '13px', fontWeight: '700', textAlign: 'center',
        background: warningBg, color: warning, borderBottom: `1px solid ${warning}`,
      }}
    >
      <span>
        This device's clock is {describeLag(behindMs)} behind. Turn on automatic date and time in the device settings so times on sales and records are correct.
      </span>
      <button
        onClick={() => setDismissed(true)}
        style={{ border: `1px solid ${warning}`, background: 'transparent', color: warning, borderRadius: theme.radius.md, padding: '4px 10px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
      >
        Dismiss
      </button>
    </div>
  )
}
