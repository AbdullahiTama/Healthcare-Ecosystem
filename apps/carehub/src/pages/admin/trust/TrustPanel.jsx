import { useState } from 'react'
import { Shield, Eye, FileText, Flag, AlertTriangle, Pill } from 'lucide-react'
import TrustQueue from './TrustQueue'
import Verifications from './Verifications'
import Moderation from './Moderation'
import Claims from './Claims'
import DrugIntel from './DrugIntel'

const SUBS = [
  { id: 'queue', label: 'Queue', icon: Shield, comp: TrustQueue },
  { id: 'verify', label: 'Verifications', icon: Eye, comp: Verifications },
  { id: 'claims', label: 'Claims', icon: FileText, comp: Claims },
  { id: 'moderation', label: 'Moderation', icon: Flag, comp: Moderation },
  { id: 'drug', label: 'Drug Intel', icon: Pill, comp: DrugIntel },
]

export default function TrustPanel() {
  const [sub, setSub] = useState('queue')
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
