import { useState, useEffect } from 'react'
import { Users, UserPlus, DollarSign, Search, Download, ShoppingCart, Calendar, Landmark } from 'lucide-react'
import { getClients, addClient, updateClient, getSalesByClient, getAppointmentsByClient, getDebtsByClient } from '../../services/supabase'
import { fmt, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, Avatar, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, border, bg, danger, success } = theme

const HISTORY_TABS = [
  ['sales', ShoppingCart, 'Sales'],
  ['appointments', Calendar, 'Appointments'],
  ['debts', Landmark, 'Debts'],
]

export default function Clients({ brand, role, perms }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [historyTab, setHistoryTab] = useState('sales')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])

  // Full per-client history across POS, appointments and debts, linked via the
  // client_id columns (20260801_customer_and_requisition_modules.sql).
  useEffect(() => {
    if (!selected?.id) { setHistory([]); return }
    let live = true
    setHistoryLoading(true)
    const fetchHistory = historyTab === 'sales' ? getSalesByClient : historyTab === 'appointments' ? getAppointmentsByClient : getDebtsByClient
    fetchHistory(selected.id).then(h => { if (live) setHistory(h || []) }).catch(() => { if (live) setHistory([]) }).finally(() => { if (live) setHistoryLoading(false) })
    return () => { live = false }
  }, [selected?.id, historyTab])

  async function load() {
    setLoading(true)
    try { const c = await getClients(brand.id); setClients(c || []) } catch (e) {}
    setLoading(false)
  }

  async function save() {
    if (!form.fullName || !form.phone) { showToast('Please enter client name and phone number.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await addClient({
        business_id: brand.id,
        full_name: form.fullName,
        phone: form.phone,
        email: form.email || '',
        address: form.address || '',
        date_of_birth: form.dob || '',
        gender: form.gender || '',
        notes: form.notes || '',
        total_spend: 0,
        visit_count: 0,
      })
      showToast('Client added!', { type: 'success' })
      setForm({}); setShowAdd(false); load()
    } catch (e) { showToast('Could not save client. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  function exportCsv() {
    const rows = [['Name', 'Phone', 'Email', 'Gender', 'Date of Birth', 'Address', 'Total Spend', 'Visits', 'Joined']]
    clients.forEach(c => {
      rows.push([c.full_name || '', c.phone || '', c.email || '', c.gender || '', c.date_of_birth || '', c.address || '', c.total_spend || 0, c.visit_count || 0, c.created_at?.split('T')[0] || ''])
    })
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Clients.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Clients exported as CSV!', { type: 'success' })
  }

  const filtered = clients.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  )

  const thisMonth = new Date().toISOString().slice(0, 7)
  const newThisMonth = clients.filter(c => c.created_at?.startsWith(thisMonth)).length
  const totalSpend = clients.reduce((s, c) => s + (c.total_spend || 0), 0)

  return (
    <div>
      <SectionHead title='Clients' sub='All your client and patient records' btn='+ Add Client' onBtn={() => setShowAdd(true)} extraBtn={{ label: 'Export CSV', icon: <Download size={14} />, onClick: exportCsv }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Users />} label='Total Clients' value={clients.length} />
        <StatCard icon={<UserPlus />} label='New This Month' value={newThisMonth} />
        <StatCard icon={<DollarSign />} label='Total Lifetime Spend' value={fmt(totalSpend)} />
      </div>

      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
        <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search by name, phone or email...'
          style={{ flex: 1, padding: '11px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Users size={40} />} message={search ? 'No clients match your search' : 'No clients yet. Add your first client!'} action='+ Add Client' onAction={() => setShowAdd(true)} cause={search ? 'filtered' : 'none'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(c => (
            <Card key={c.id} style={{ padding: '16px', cursor: 'pointer' }} onClick={() => setSelected(c)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                  <Avatar name={c.full_name} size={44} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{c.full_name}</div>
                    <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{c.phone || 'No phone'}{c.email ? ' · ' + c.email : ''}</div>
                    <div style={{ fontSize: '12px', color: gray400, marginTop: '2px' }}>{c.gender || ''}{c.date_of_birth ? ' · DOB: ' + c.date_of_birth : ''}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: '900', color: navy }}>{fmt(c.total_spend || 0)}</div>
                  <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{c.visit_count || 0} visit(s)</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add Client Modal */}
      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({}) }} title='Add New Client'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Add Client'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Full Name *' value={form.fullName} onChange={v => f('fullName', v)} placeholder='Client full name' required />
          <Inp label='Phone Number *' value={form.phone} onChange={v => f('phone', v)} placeholder='08012345678' required />
          <Inp label='Email' value={form.email} onChange={v => f('email', v)} type='email' placeholder='client@email.com' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Date of Birth' value={form.dob} onChange={v => f('dob', v)} type='date' />
            <Sel label='Gender' value={form.gender} onChange={v => f('gender', v)} options={['Male', 'Female', 'Other']} />
          </div>
          <Inp label='Address' value={form.address} onChange={v => f('address', v)} placeholder='Home address' />
          <Textarea label='Notes' value={form.notes} onChange={v => f('notes', v)} placeholder='Any notes about this client...' rows={2} />
        </div>
      </Modal>

      {/* Client Detail Modal */}
      <Modal show={!!selected} onClose={() => setSelected(null)} title='Client Details'>
        {selected && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', padding: '16px', borderRadius: theme.radius.lg, background: bg }}>
              <Avatar name={selected.full_name} size={56} />
              <div>
                <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>{selected.full_name}</div>
                <div style={{ fontSize: '13px', color: gray500, marginTop: '4px' }}>{selected.phone}</div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                  <div><div style={{ fontSize: '18px', fontWeight: '900', color: tealDeep }}>{fmt(selected.total_spend || 0)}</div><div style={{ fontSize: '11px', color: gray400 }}>Total spent</div></div>
                  <div><div style={{ fontSize: '18px', fontWeight: '900', color: navy }}>{selected.visit_count || 0}</div><div style={{ fontSize: '11px', color: gray400 }}>Visits</div></div>
                </div>
              </div>
            </div>
            {[['Email', selected.email || '—'], ['Gender', selected.gender || '—'], ['Date of Birth', selected.date_of_birth || '—'], ['Address', selected.address || '—'], ['Notes', selected.notes || '—'], ['Joined', selected.created_at?.split('T')[0] || '—']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${gray100}`, fontSize: '13px', gap: 16 }}>
                <span style={{ color: gray500, fontWeight: '600' }}>{l}</span>
                <span style={{ color: navy, textAlign: 'right', maxWidth: '240px' }}>{v}</span>
              </div>
            ))}

            {/* Full history across POS, appointments and debts */}
            <div style={{ marginTop: '22px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', marginBottom: '10px' }}>History</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {HISTORY_TABS.map(([key, Icon, label]) => {
                  const on = historyTab === key
                  return (
                    <button key={key} onClick={() => setHistoryTab(key)} aria-pressed={on}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 13px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600 }}>
                      <Icon size={13} /> {label}
                    </button>
                  )
                })}
              </div>
              {historyLoading ? <Loading /> : history.length === 0 ? (
                <div style={{ padding: '22px 14px', borderRadius: '10px', background: bg, textAlign: 'center', fontSize: '12px', color: gray500 }}>
                  {historyTab === 'sales' ? 'No sales recorded for this client yet. Charge them at the POS and link their name to build history.' : historyTab === 'appointments' ? 'No appointments yet. Book one from Appointments and pick this client.' : 'No debts for this client yet. Credit sales and manual debts will appear here.'}
                </div>
              ) : historyTab === 'sales' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {history.map(s => {
                    let items = []
                    try { items = JSON.parse(s.items || '[]') } catch (e) {}
                    return (
                      <div key={s.id} style={{ padding: '11px 13px', borderRadius: '10px', border: `1px solid ${gray100}`, background: bg }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: '700', fontSize: '12px', color: navy }}>{s.txn_no || '—'}</span>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: tealDeep }}>{fmt(s.total || 0)}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: gray500, marginTop: '3px' }}>
                          {s.created_at?.slice(0, 16).replace('T', ' ') || '—'} · {s.payment_method || '—'}{s.balance > 0 ? ' · Balance: ' + fmt(s.balance) : ''}
                        </div>
                        {items.length > 0 && <div style={{ fontSize: '11px', color: gray400, marginTop: '3px' }}>{items.map(i => i.name + ' x' + i.qty).join(', ')}</div>}
                      </div>
                    )
                  })}
                </div>
              ) : historyTab === 'appointments' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {history.map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '11px 13px', borderRadius: '10px', border: `1px solid ${gray100}`, background: bg }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '12px', color: navy }}>{a.service || 'Appointment'}</div>
                        <div style={{ fontSize: '11px', color: gray500, marginTop: '2px' }}>{a.date || '—'} at {a.time || '—'}{a.staff_name ? ' · ' + a.staff_name : ''}</div>
                      </div>
                      <Pill label={a.status} type={a.status === 'confirmed' ? 'green' : a.status === 'completed' ? 'teal' : a.status === 'cancelled' ? 'red' : 'amber'} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {history.map(d => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '11px 13px', borderRadius: '10px', border: `1px solid ${gray100}`, background: bg }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '11px', color: gray500 }}>{d.created_at?.slice(0, 10) || '—'} · {d.direction === 'owes_us' ? 'Owes us' : 'We owe'}</div>
                        <div style={{ fontWeight: '700', fontSize: '12px', color: navy, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{d.description || d.party_name || '—'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '900', fontSize: '13px', color: (d.balance || 0) > 0 ? danger : success }}>{fmt(d.balance || 0)}</div>
                        <div style={{ fontSize: '10px', color: gray400 }}>balance</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
