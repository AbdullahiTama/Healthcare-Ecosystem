import { useState } from 'react'
import { Building2, Upload, Tags } from 'lucide-react'
import DirectoryList from './DirectoryList'
import DirectoryImport from './DirectoryImport'
import DirectoryCategories from './DirectoryCategories'

// Platform-admin console for the shared business directory. Mounted only from
// AdminDashboard behind the 'Directory' platform permission. The database,
// not this gate, decides who may write (is_directory_admin(), see
// carehub_20261120_business_directory.sql): a non-admin who reached this panel
// would see every save refused.
const SUBS = [
  { id: 'businesses', label: 'Businesses', icon: Building2, comp: DirectoryList },
  { id: 'import', label: 'Import', icon: Upload, comp: DirectoryImport },
  { id: 'categories', label: 'Categories', icon: Tags, comp: DirectoryCategories },
]

export default function DirectoryPanel() {
  const [sub, setSub] = useState('businesses')
  const Active = (SUBS.find((s) => s.id === sub) || SUBS[0]).comp
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="tablist" aria-label="Directory sections" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {SUBS.map((s) => (
          <button key={s.id} role="tab" aria-selected={sub === s.id} onClick={() => setSub(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap', border: sub === s.id ? '1px solid var(--teal)' : '1px solid var(--border)', background: sub === s.id ? 'var(--teal-mist)' : 'var(--panel)', color: sub === s.id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
            <s.icon size={13} aria-hidden="true" /> {s.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  )
}
