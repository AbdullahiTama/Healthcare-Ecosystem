import { useState } from 'react'
import { Wallet, Layers, TrendingUp, Repeat, ScrollText, Receipt } from 'lucide-react'
import PlanCatalog from './PlanCatalog'
import Subscriptions from './Subscriptions'
import RevenueOverview from './RevenueOverview'
import Reconciliation from './Reconciliation'
import Invoices from './Invoices'

const SUBS = [
  { id: 'revenue', label: 'Revenue', icon: TrendingUp, comp: RevenueOverview },
  { id: 'catalog', label: 'Catalog', icon: Layers, comp: PlanCatalog },
  { id: 'subs', label: 'Subscriptions', icon: ScrollText, comp: Subscriptions },
  { id: 'recon', label: 'Reconciliation', icon: Repeat, comp: Reconciliation },
  { id: 'invoices', label: 'Invoices', icon: Receipt, comp: Invoices },
]

export default function MoneyPanel() {
  const [sub, setSub] = useState('revenue')
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
