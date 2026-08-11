import { useEffect, useState } from 'react'
import { supabase } from '../config/supabaseClient'

// Feeds AppShell/DesktopHeader/LeftSidebar's avatar + unread-notifications
// badge. Extracted from Feed.jsx (the first screen to need this data) so
// every other AppShell-wrapped screen shares one query instead of
// re-deriving it per page.
export function useHeaderIdentity(user) {
  const [myUsername, setMyUsername] = useState('')
  const [myAvatar, setMyAvatar] = useState(null)
  const [unreadNotifs, setUnreadNotifs] = useState(0)

  useEffect(() => {
    if (!user) { setMyUsername(''); setMyAvatar(null); setUnreadNotifs(0); return }

    supabase
      .from('profiles')
      .select('full_name, display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMyUsername(data?.display_name || data?.full_name || '')
        setMyAvatar(data?.avatar_url || null)
      })

    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .eq('read', false)
      .then(({ count }) => setUnreadNotifs(count || 0))
  }, [user])

  return { myUsername, myAvatar, unreadNotifs }
}
