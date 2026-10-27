import { useState } from 'react'
import { useAuth } from '../../providers/AuthProvider'
import { ConfirmDialog } from '../ui'
import { switchLocation, switchBlockers } from '../../lib/locationSwitch'

// The one way a screen offers a location switch (top-bar switcher, Locations page). request(location) switches at
// once, or first asks when something open would be lost (a POS cart: lib/locationSwitch registerSwitchBlocker).
// Render `dialog` once. onSwitched(location) runs after a switch actually happened.
export function useLocationSwitch(onSwitched) {
  const { auth, setAuth } = useAuth()
  const [pending, setPending] = useState(null) // { location, message }

  function apply(location) {
    if (switchLocation({ auth, setAuth }, location) && onSwitched) onSwitched(location)
  }

  function request(location) {
    if (!location || (auth && auth.brand && auth.brand.id === location.id)) return
    const messages = switchBlockers()
    if (messages.length > 0) setPending({ location, message: messages.join(' ') })
    else apply(location)
  }

  const dialog = (
    <ConfirmDialog show={!!pending} onClose={() => setPending(null)}
      onConfirm={() => { const location = pending.location; setPending(null); apply(location) }}
      title='Switch location?' consequence={pending ? pending.message : ''} confirmLabel='Switch anyway' danger={false} />
  )

  return { request, dialog }
}
