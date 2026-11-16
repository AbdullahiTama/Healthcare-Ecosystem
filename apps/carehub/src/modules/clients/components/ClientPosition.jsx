import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Landmark, Plus } from 'lucide-react'
import { GhostBtn, TealBtn, Input } from '../../../components/ui'
import { debtRepository } from '../../debts/repositories'
import { fmt, todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { describePosition } from '../clientFilters'
import { readOpening, recordOpeningBalances, BALANCE_TYPES } from '../clientImport'

const { navy, gray500, gray600, border, danger, dangerBg, tealDeep, tealMist, bg } = theme

// A client's financial position on their profile: Client Owes Us, We Owe Client or Settled, with what makes it up,
// and (for the Owner or a manager) Add opening balance. `position` is { owes, credit, net } from clientPositions (the
// open debts Debt Management shows), or null while they load; `failed` when they could not be read.
// Docs: docs/architecture/Client-Position-and-Opening-Balances.md.
export default function ClientPosition({ brand, client, position, failed, canRecordOpening, showToast, debtRepo = debtRepository }) {
  const [adding, setAdding] = useState(false)
  const p = position ? describePosition(position) : null
  const tone = !p ? { bg, fg: navy } : p.status === 'owes' ? { bg: dangerBg, fg: danger } : p.status === 'credit' ? { bg: tealMist, fg: tealDeep } : { bg, fg: navy }

  return (
    <section aria-label='Account position' style={{ marginBottom: 18, padding: 14, borderRadius: theme.radius.lg, background: tone.bg, border: `1px solid ${border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Landmark size={18} color={tone.fg} aria-hidden='true' />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: gray500, textTransform: 'uppercase' }}>Account position</div>
            {failed ? <div role='alert' style={{ fontSize: 13, color: danger, fontWeight: 700 }}>Could not load balances</div>
              : !p ? <div style={{ fontSize: 13, color: gray600 }}>Loading…</div>
                : <div style={{ fontSize: 18, fontWeight: 900, color: tone.fg }}>{p.label}{p.amount ? ' ' + fmt(p.amount) : ''}</div>}
          </div>
        </div>
        {canRecordOpening && !adding && (
          <GhostBtn onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'white' }}>
            <Plus size={13} aria-hidden='true' /> Add opening balance
          </GhostBtn>
        )}
      </div>
      {p && position.owes > 0 && position.credit > 0 && (
        <div style={{ fontSize: 12, color: gray600, marginTop: 8 }}>
          Owes us {fmt(position.owes)} · we owe them {fmt(position.credit)}
        </div>
      )}
      {adding && (
        <OpeningBalanceForm brand={brand} client={client} debtRepo={debtRepo} showToast={showToast} onDone={() => setAdding(false)} />
      )}
    </section>
  )
}

// Opening balance for one client: what they owed, or were owed, before CareHub, as an opening entry on their account
// (never a sale or a payment). One per client: the database refuses a second.
function OpeningBalanceForm({ brand, client, debtRepo, showToast, onDone }) {
  const [form, setForm] = useState({ type: 'owes_us', amount: '', date: todayDate() })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setError('') }

  async function save() {
    if (!(Number(form.amount) > 0)) { setError('Enter the opening balance amount.'); return }
    const { opening, error: problem } = readOpening({ amount: form.amount, type: BALANCE_TYPES[form.type], date: form.date }, { today: todayDate() })
    if (problem) { setError(problem); return }
    setSaving(true)
    const r = await recordOpeningBalances(brand.id, [{ client, opening }], { debtRepo })
    setSaving(false)
    if (r.already.length) { setError(`${client.full_name} already has an opening balance. Payments and changes go through Debts.`); return }
    if (r.failed.length) { console.error('[clients] opening balance failed:', r.failed[0].message); setError('Could not save the opening balance. Check your connection and try again.'); return }
    console.info('[clients] opening balance recorded', { client: client.id, direction: opening.direction, amount: opening.amount })
    queryClient.invalidateQueries({ queryKey: ['debts'] })
    queryClient.invalidateQueries({ queryKey: ['clients'] })
    showToast(`Opening balance recorded: ${BALANCE_TYPES[opening.direction]} ${fmt(opening.amount)}.`, { type: 'success' })
    onDone()
  }

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <legend style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Balance type</legend>
        {Object.entries(BALANCE_TYPES).map(([k, label]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: navy, cursor: 'pointer', minHeight: 32 }}>
            <input type='radio' name='opening-type' checked={form.type === k} onChange={() => set('type', k)} style={{ accentColor: tealDeep }} /> {label}
          </label>
        ))}
      </fieldset>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 10 }}>
        <Input id='opening-amount' label='Amount (₦)' type='number' min='0' value={form.amount} onChange={(v) => set('amount', v)} placeholder='0' />
        <Input id='opening-date' label='As at' type='date' value={form.date} onChange={(v) => set('date', v)} />
      </div>
      <div style={{ fontSize: 11.5, color: gray500 }}>Recorded on the account as an opening entry, not a sale or a payment. One per client.</div>
      {error && <div role='alert' style={{ fontSize: 12.5, color: danger }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <GhostBtn onClick={onDone} disabled={saving} style={{ flex: 1, padding: 10 }}>Cancel</GhostBtn>
        <TealBtn onClick={save} disabled={saving} style={{ flex: 1, padding: 10 }}>{saving ? 'Saving…' : 'Save opening balance'}</TealBtn>
      </div>
    </div>
  )
}
