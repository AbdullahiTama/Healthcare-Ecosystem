import { useState } from 'react'
import { Layers, TrendingUp, MapPin } from 'lucide-react'
import Hierarchy from './Hierarchy'
import Performance from './Performance'
import { CoveragePanel as ReferralCoveragePanel } from '../referral/AdminReferralPanels'

const SUBS = [
  { id: 'hierarchy', label: 'Hierarchy', icon: Layers, comp: Hierarchy },
  { id: 'performance', label: 'Performance', icon: TrendingUp, comp: Performance },
  { id: 'coverage', label: 'Coverage', icon: MapPin, comp: ReferralCoveragePanel },
]

export default function GrowthPanel() {
  const [sub, setSub] = useState('hierarchy')
  const Active = (SUBS.find(s => s.id === sub) || SUBS[0]).comp
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {SUBS.map(s => (
          <button key={s.id} onClick={() => setSub(s.id)} aria-current={sub === s.id ? 'page' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap', border: sub === s.id ? '1px solid var(--teal)' : '1px solid var(--border)', background: sub === s.id ? 'var(--teal-mist)' : 'var(--panel)', color: sub === s.id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
            <s.icon size={13} /> {s.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  )
}
