import { useState } from 'react'
import { LayoutDashboard, ShieldAlert, Bug, Database, Inbox, HardDrive, ToggleLeft, ScrollText } from 'lucide-react'
import HealthLights from './HealthLights'
import AuditLog from './AuditLog'
import FeatureFlags from './FeatureFlags'
import ErrorInbox from './ErrorInbox'
import MigrationTracker from './MigrationTracker'
import JobQueue from './JobQueue'
import AbuseStorage from './AbuseStorage'

const SUBS = [
  { id: 'lights', label: 'Lights & Banner', icon: ShieldAlert, comp: HealthLights },
  { id: 'audit', label: 'Audit Log', icon: ScrollText, comp: AuditLog },
  { id: 'flags', label: 'Switches', icon: ToggleLeft, comp: FeatureFlags },
  { id: 'errors', label: 'Errors', icon: Bug, comp: ErrorInbox },
  { id: 'migrations', label: 'Migrations', icon: Database, comp: MigrationTracker },
  { id: 'jobs', label: 'Jobs', icon: Inbox, comp: JobQueue },
  { id: 'storage', label: 'Abuse/Storage', icon: HardDrive, comp: AbuseStorage },
]

export default function HealthPanel() {
  const [sub, setSub] = useState('lights')
  const Active = (SUBS.find(s => s.id === sub) || SUBS[0]).comp
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
        {SUBS.map(s => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            aria-current={sub === s.id ? 'page' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap',
              border: sub === s.id ? '1px solid var(--teal)' : '1px solid var(--border)',
              background: sub === s.id ? 'var(--teal-mist)' : 'var(--panel)',
              color: sub === s.id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <s.icon size={13} /> {s.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  )
}
