import { useState, useEffect } from 'react'
import { Landmark, Truck, ShoppingCart, Pencil, Search, UserCheck } from 'lucide-react'
import { debtRepository } from './repositories'
// Cross-aggregate read: the client list belongs to the clients module, which
// exposes it through its own repository. `getClients` is still the shared
// services/supabase read used by POS too — repoint it when that call is
// consolidated; it is unrelated to this module's own aggregate.
import { getClients } from '../../services/supabase'
import { fmt, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, bg } = theme

// `short`: the Details-column pill has less room than the Source column, so it
// uses "Sale" instead of "Credit Sale" — same icon/source mapping either way.
function sourceLabel(source, short) {
  const Icon = source === 'purchase' ? Truck : source === 'credit_sale' ? ShoppingCart : Pencil
  const text = source === 'purchase' ? 'Purchase' : source === 'credit_sale' ? (short ? 'Sale' : 'Credit Sale') : 'Manual'
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Icon size={11} /> {text}</span>
}

export default function Debts({ brand, role, perms }) {
  const [debts, setDebts] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ direction: 'owes_us' })
  const [saving, setSaving] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => {
    let live = true
    getClients(brand.id).then(c => { if (live) setClients(c || []) }).catch(() => {})
    return () => { live = false }
  }, [brand?.id])

  // Picking a saved client links the debt to their customer record so it
  // shows up on their history.
  function pickClient(name) {
    const c = clients.find(x => x.full_name === name)
    setForm(p => ({ ...p, party: name, client_id: c?.id || null }))
  }

  async function load() {
    setLoading(true)
    try { const d = await debtRepository.getAll(brand.id); setDebts(d || []) } catch (e) {}
    setLoading(false)
  }

  async function save() {
    if (!form.party || !form.amount) { showToast('Please enter party name and amount.', { type: 'warning' }); return }
    setSaving(true)
    try {
      const amt = parseFloat(form.amount) || 0
      const paid = parseFloat(form.amountPaid) || 0
      await debtRepository.create(brand.id, {
        client_id: form.client_id || null,
        direction: form.direction || 'owes_us',
        party_name: form.party,
        amount: amt,
        amount_paid: paid,
        balance: amt - paid,
        due_date: form.dueDate || '',
        status: paid >= amt ? 'paid' : 'pending',
        description: form.description || '',
      })
      showToast('Debt recorded!', { type: 'success' })
      setForm({ direction: 'owes_us' }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save debt. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  async function markPaid(debt) {
    try {
      await debtRepository.update(debt.id, brand.id, { amount_paid: debt.amount, balance: 0, status: 'paid' })
      load(); showToast('Marked as paid!', { type: 'success' })
    } catch (e) { showToast('Could not mark as paid. Please try again.', { type: 'error' }) }
  }

  const filtered = debts.filter(d => {
    const matchSearch = !search || d.party_name.toLowerCase().includes(search.toLowerCase())
    const matchMonth = !filterMonth || d.created_at?.startsWith(filterMonth)
    return matchSearch && matchMonth
  })

  const owedToUs = debts.filter(d => d.direction === 'owes_us').reduce((s, d) => s + (d.balance || 0), 0)
  const weOwe = debts.filter(d => d.direction === 'we_owe').reduce((s, d) => s + (d.balance || 0), 0)

  return (
    <div>
      <SectionHead title='Debts' sub='Track money owed to you and money you owe' btn='+ Record Debt' onBtn={() => setShowAdd(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${success}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>Clients owe you</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: success, marginTop: '6px' }}>{fmt(owedToUs)}</div>
        </Card>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${danger}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>You owe others</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: danger, marginTop: '6px' }}>{fmt(weOwe)}</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search party name...'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <input type='month' value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        {filterMonth && <button onClick={() => setFilterMonth('')} style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>Clear</button>}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Landmark size={40} />} message='No debts recorded' action='+ Record Debt' onAction={() => setShowAdd(true)} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Source', 'Direction', 'Party', 'Details', 'Amount', 'Paid', 'Balance', 'Due Date', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: '12px 14px' }}>
                      <Pill label={sourceLabel(d.source, false)} type={d.source === 'purchase' ? 'amber' : d.source === 'credit_sale' ? 'blue' : 'gray'} />
                    </td>
                    <td style={{ padding: '12px 14px' }}><Pill label={d.direction === 'owes_us' ? 'Owed to Us' : 'We Owe'} type={d.direction === 'owes_us' ? 'green' : 'red'} /></td>
                    <td style={{ padding: '12px 14px', fontWeight: '700', fontSize: '13px', color: navy }}>
                      {d.party_name}
                      {d.client_id && <div style={{ marginTop: '4px' }}><Pill label={<> <UserCheck size={10} /> Client record</>} type='teal' /></div>}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500, maxWidth: '200px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.description || '—'}</div>
                      {d.source && <div style={{ marginTop: '4px' }}><Pill label={sourceLabel(d.source, true)} type={d.source === 'purchase' ? 'amber' : d.source === 'credit_sale' ? 'blue' : 'gray'} /></div>}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(d.amount)}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: success }}>{fmt(d.amount_paid || 0)}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '900', color: (d.balance || 0) > 0 ? danger : success }}>{fmt(d.balance || 0)}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: gray400 }}>{d.due_date || '—'}</td>
                    <td style={{ padding: '12px 14px' }}><Pill label={d.status} type={d.status === 'paid' ? 'green' : 'amber'} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      {d.status !== 'paid' && <button onClick={() => markPaid(d)} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Mark paid</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ direction: 'owes_us' }) }} title='Record Debt'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ direction: 'owes_us' }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Debt'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Direction</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[['owes_us', 'Client owes us'], ['we_owe', 'We owe someone']].map(([val, label]) => (
                <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${form.direction === val ? tealDeep : border}`, background: form.direction === val ? tealMist : 'white', cursor: 'pointer', fontSize: '13px', color: navy }}>
                  <input type='radio' checked={form.direction === val} onChange={() => f('direction', val)} style={{ accentColor: tealDeep }} />{label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Party Name *</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input list='debt-clients' value={form.party || ''} onChange={e => pickClient(e.target.value)} placeholder='Pick a saved client or type a name...'
                style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
              <datalist id='debt-clients'>
                {clients.map(c => <option key={c.id} value={c.full_name} />)}
              </datalist>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Total Amount (₦) *' value={form.amount} onChange={v => f('amount', v)} type='number' placeholder='0' required />
            <Inp label='Amount Already Paid (₦)' value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0' />
          </div>
          {form.amount && <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: gray500 }}>Balance remaining</span>
            <span style={{ fontWeight: '900', color: danger }}>{fmt((parseFloat(form.amount) || 0) - (parseFloat(form.amountPaid) || 0))}</span>
          </div>}
          <Inp label='Due Date' value={form.dueDate} onChange={v => f('dueDate', v)} type='date' />
          <Textarea label='Description' value={form.description} onChange={v => f('description', v)} placeholder='What is this debt for?' rows={2} />
        </div>
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
