import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import { getAllLocations } from '../../services/supabase'
import { theme } from '../../styles/theme'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border } = theme

// Persistent branch switcher for the business owner. Shows the active branch in
// the top bar; clicking opens a dropdown of every branch the owner can reach
// (parent + all descendants via the recursive current_business_ids()). Selecting
// one swaps auth.brand to that branch, which re-scopes every repository call.
//
// Rendered only when the user is the Owner and more than one branch exists.
export default function BranchSwitcher() {
  const { auth, setAuth } = useAuth()
  const brand = auth?.brand
  const role = auth?.role
  const [branches, setBranches] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (role !== 'Owner' || !brand?.id) { setLoading(false); return }
    let live = true
    getAllLocations(brand.id).then(list => {
      if (!live) return
      setBranches(list || [])
      setLoading(false)
    }).catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [brand?.id, role])

  if (role !== 'Owner' || loading || branches.length <= 1) return null

  function switchTo(branch) {
    setOpen(false)
    if (branch.id === brand?.id) return
    const newAuth = { ...auth, brand: branch, staff: null, role: 'Owner' }
    setAuth(newAuth)
    try { localStorage.setItem('carehub_auth', JSON.stringify(newAuth)) } catch (e) {}
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Switch branch"
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 10px', borderRadius: theme.radius.md,
          border: `1px solid ${border}`, background: tealMist,
          cursor: 'pointer', fontSize: '12px', fontWeight: '700', color: tealDeep,
          maxWidth: 180,
        }}>
        <MapPin size={13} style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand?.name || 'Branch'}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
          background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 200, maxWidth: 280,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 12px', fontSize: '10px', fontWeight: '700', color: gray400, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${border}` }}>
            Switch branch
          </div>
          {branches.map(b => {
            const active = b.id === brand?.id
            return (
              <button
                key={b.id}
                onClick={() => switchTo(b)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '9px 12px', border: 'none', cursor: 'pointer',
                  background: active ? tealMist : 'transparent',
                  textAlign: 'left', fontSize: '12px', fontWeight: active ? '700' : '500',
                  color: active ? tealDeep : gray600,
                }}>
                <MapPin size={12} style={{ flexShrink: 0, color: active ? tealDeep : gray400 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                {active && <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: '800', color: tealDeep, flexShrink: 0 }}>ACTIVE</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
