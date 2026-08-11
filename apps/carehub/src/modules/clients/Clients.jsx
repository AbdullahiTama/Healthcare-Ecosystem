import { useState, useEffect, useMemo } from 'react'
import { Users, UserPlus, DollarSign, Search, Download, Upload, ShoppingCart, Calendar, Landmark, Clipboard, History, FileUp, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { clientRepository } from './repositories'
import { PHARMACY_TYPE_LABEL } from '../consultation/PharmacyForm'
import { fmt, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, Avatar, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, bg, danger, dangerBg, warning, success } = theme

const HISTORY_TABS = [
  ['timeline', History, 'Timeline'],
  ['sales', ShoppingCart, 'Sales'],
  ['appointments', Calendar, 'Appointments'],
  ['consultations', Clipboard, 'Consultations'],
  ['debts', Landmark, 'Debts'],
]

const parseC = (c) => {
  try { return typeof c.data === 'string' ? JSON.parse(c.data) : (c.data || {}) } catch (e) { return {} }
}

const saleItems = (s) => {
  try { return JSON.parse(s.items || '[]') } catch (e) { return [] }
}

function SourcePill({ source }) {
  if (source === 'recommended') return <Pill label='rec' type='purple' style={{ fontSize: 9 }} />
  if (source === 'dispensed') return <Pill label='dispensed' type='blue' style={{ fontSize: 9 }} />
  return null
}

function SaleRow({ s }) {
  const items = saleItems(s)
  return (
    <div style={{ padding: '11px 13px', borderRadius: '10px', border: `1px solid ${gray100}`, background: bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: '700', fontSize: '12px', color: navy }}>{s.txn_no || '—'}</span>
        <span style={{ fontSize: '12px', fontWeight: '700', color: tealDeep }}>{fmt(s.total || 0)}</span>
      </div>
      <div style={{ fontSize: '11px', color: gray500, marginTop: '3px' }}>
        {s.created_at?.slice(0, 16).replace('T', ' ') || '—'} · {s.payment_method || '—'}{s.balance > 0 ? ' · Balance: ' + fmt(s.balance) : ''}
      </div>
      {items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '11px', color: gray400, marginTop: '3px' }}>
          {items.map(i => (
            <span key={i.id || i.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {i.name + ' x' + i.qty}
              <SourcePill source={i.source} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ConsultationRow({ c }) {
  const d = parseC(c)
  const subTypes = (d.type_of_consultation?.selected || []).map(k => PHARMACY_TYPE_LABEL[k]).filter(Boolean)
  const skinType = d.assessment?.skin_type || ''
  const prods = c.recommended_products || []
  const isPh = c.consultation_type === 'pharmacy'
  return (
    <div style={{ padding: '11px 13px', borderRadius: '10px', border: `1px solid ${gray100}`, background: bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: '700', fontSize: '12px', color: navy }}>{c.consultation_date || '—'}</span>
        <div style={{ display: 'flex', gap: 5 }}>
          <Pill label={isPh ? 'Pharmacy' : 'Skincare'} type={isPh ? 'blue' : 'green'} style={{ fontSize: 9 }} />
          {isPh ? subTypes.map(s => <Pill key={s} label={s} type='teal' style={{ fontSize: 9 }} />) : skinType && <Pill label={skinType} type='teal' style={{ fontSize: 9 }} />}
          {prods.length > 0 && <Pill label={prods.length + ' rec'} type='purple' style={{ fontSize: 9 }} />}
        </div>
      </div>
      {c.provider_name && <div style={{ fontSize: '11px', color: gray500, marginTop: '3px' }}>{isPh ? 'Pharmacist: ' : 'Therapist: '}{c.provider_name}</div>}
      {prods.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '11px', color: gray400, marginTop: '3px' }}>
          {prods.map(p => (
            <span key={p.id || p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {p.name + (p.qty > 1 ? ' x' + p.qty : '')}
              <SourcePill source={p.source} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelineRow({ e }) {
  if (e.kind === 'sale') return <SaleRow s={e} />
  return <ConsultationRow c={e} />
}

export default function Clients({ brand, role, perms }) {
  const navigate = useNavigate()
  const canConsult = brand?.business_type === 'skincare' || brand?.business_type === 'pharmacy'
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [historyTab, setHistoryTab] = useState('timeline')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [clientSales, setClientSales] = useState([])
  const [clientConsults, setClientConsults] = useState([])
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', source: '', product: '', type: '' })
  const setF = (k, v) => setFilters(p => ({ ...p, [k]: v }))
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  // Bulk upload state — mirrors the Inventory CSV flow (download template,
  // fill in Excel, save as CSV, upload here).
  const [showUpload, setShowUpload] = useState(false)
  const [uploadData, setUploadData] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => { load() }, [brand?.id])

  // Dedicated raw lists for the timeline merge + "currently on" traceability.
  useEffect(() => {
    if (!selected?.id || !brand?.id) { setClientSales([]); setClientConsults([]); return }
    let live = true
    clientRepository.getSales(selected.id, brand.id).then(s => { if (live) setClientSales(s || []) }).catch(() => { if (live) setClientSales([]) })
    clientRepository.getConsultations(selected.id, brand.id).then(c => { if (live) setClientConsults(c || []) }).catch(() => { if (live) setClientConsults([]) })
    return () => { live = false }
  }, [selected?.id, brand?.id])

  // Full per-client history across POS, appointments, consultations and debts,
  // linked via the client_id columns (20260801_customer_and_requisition_modules.sql).
  useEffect(() => {
    if (!selected?.id || !brand?.id) { setHistory([]); return }
    let live = true
    setHistoryLoading(true)
    if (historyTab === 'timeline') {
      const merged = [
        ...clientSales.map(s => ({ ...s, kind: 'sale', when: s.created_at || '' })),
        ...clientConsults.map(c => ({ ...c, kind: 'consultation', when: (c.consultation_date || '') + 'T' + (c.created_at?.split('T')[1] || '00:00:00') })),
      ].sort((a, b) => b.when.localeCompare(a.when))
      if (live) { setHistory(merged); setHistoryLoading(false) }
      return () => { live = false }
    }
    const fetchHistory = historyTab === 'sales' ? clientRepository.getSales
      : historyTab === 'appointments' ? clientRepository.getAppointments
      : historyTab === 'consultations' ? clientRepository.getConsultations
      : clientRepository.getDebts
    fetchHistory(selected.id, brand.id).then(h => { if (live) setHistory(h || []) }).catch(() => { if (live) setHistory([]) }).finally(() => { if (live) setHistoryLoading(false) })
    return () => { live = false }
  }, [selected?.id, brand?.id, historyTab, clientSales, clientConsults])

  async function load() {
    setLoading(true)
    try { const c = await clientRepository.getAll(brand.id); setClients(c || []) } catch (e) {}
    setLoading(false)
  }

  async function save() {
    if (!form.firstName || !form.lastName || !form.phone) { showToast('Please enter client first name, surname and phone number.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await clientRepository.create(brand.id, {
        full_name: [form.firstName, form.lastName].filter(Boolean).map(s => s.trim()).join(' '),
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

  // ── Bulk upload (CSV) ───────────────────────────────────────────────────────
  // Mirrors the Inventory product upload: download a template, fill it in
  // Excel, save as CSV, upload here. Phone number is the dedupe key — the
  // point of the feature is importing an existing customer/patient database
  // without creating duplicates.
  const normPhone = (p) => String(p || '').replace(/[^0-9]/g, '')

  function downloadClientTemplate() {
    const rows = [
      ['First Name', 'Last Name', 'Phone', 'Email', 'Gender', 'Date of Birth', 'Address', 'Notes'],
      ['Ada', 'Okafor', '08012345678', 'ada@email.com', 'Female', '1990-05-12', '12 Broad Street, Lagos', 'VIP customer'],
      ['Musa', 'Bello', '08098765432', '', 'Male', '1985-01-30', '', ''],
    ]
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Clients_Template.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Template downloaded! Fill in Excel, save as CSV, then upload.', { type: 'success' })
  }

  function handleClientFileUpload(e) {
    const file = e.target.files[0]; if (!file) return
    setUploadError(''); setUploadData([])
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const lines = ev.target.result.split('\n').filter(l => l.trim())
        if (lines.length < 2) { setUploadError('File is empty or has no clients.'); return }
        const parsed = lines.slice(1).map(line => {
          const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim())
          if (!cols[0] && !cols[1] && !cols[2]) return null
          const firstName = cols[0] || ''
          const lastName = cols[1] || ''
          return {
            full_name: [firstName, lastName].filter(Boolean).join(' '),
            phone: cols[2] || '',
            email: cols[3] || '',
            gender: cols[4] || '',
            date_of_birth: cols[5] || '',
            address: cols[6] || '',
            notes: cols[7] || '',
          }
        }).filter(Boolean)
        if (parsed.length === 0) { setUploadError('No valid clients found.'); return }
        setUploadData(parsed)
      } catch (err) { setUploadError('Error reading file. Use the downloaded template.') }
    }
    reader.readAsText(file); e.target.value = ''
  }

  async function importClients() {
    if (uploadData.length === 0) return
    setImporting(true)
    showToast('Importing ' + uploadData.length + ' clients…', { type: 'info' })
    const existingPhones = new Set(clients.map(c => normPhone(c.phone)))
    const fresh = []
    let skipped = 0
    let invalid = 0
    const invalidNames = []
    for (const c of uploadData) {
      if (!normPhone(c.phone)) {
        invalid++
        if (invalidNames.length < 5) invalidNames.push((c.full_name || 'Unknown') + ' (no phone)')
        continue
      }
      if (existingPhones.has(normPhone(c.phone))) { skipped++; continue }
      existingPhones.add(normPhone(c.phone))
      fresh.push({
        full_name: c.full_name || c.phone,
        phone: c.phone,
        email: c.email || '',
        address: c.address || '',
        date_of_birth: c.date_of_birth || '',
        gender: c.gender || '',
        notes: c.notes || '',
        total_spend: 0,
        visit_count: 0,
      })
    }
    const { added, failed } = await clientRepository.createMany(brand.id, fresh)
    await load()
    setUploadData([])
    setShowUpload(false)
    setImporting(false)
    const parts = [added + ' imported']
    if (skipped > 0) parts.push(skipped + ' skipped (already exist)')
    if (invalid > 0) parts.push(invalid + ' invalid')
    if (failed.length > 0) parts.push(failed.length + ' failed')
    const summary = parts.join(' · ')
    if (failed.length > 0) {
      showToast(summary + ': ' + failed.slice(0, 3).map(x => x.full_name + ' (' + x.message + ')').join(', '), { type: 'warning' })
    } else if (invalid > 0) {
      showToast(summary + ': ' + invalidNames.join(', '), { type: 'warning' })
    } else {
      showToast(summary + '!', { type: 'success' })
    }
  }

  // Exports whatever the client-detail History tab is currently showing
  // (timeline / sales / appointments / consultations / debts) as a flat CSV.
  function exportHistoryCsv() {
    const rowsFor = (historyTab === 'timeline' || historyTab === 'consultations') ? filteredHistory : history
    if (!rowsFor.length) { showToast('Nothing to export yet.', { type: 'warning' }); return }
    let rows
    if (historyTab === 'timeline') {
      rows = [['Date', 'Event', 'Type', 'Provider', 'Source', 'Products', 'Amount']]
      rowsFor.forEach(e => {
        if (e.kind === 'sale') {
          const items = saleItems(e)
          const srcs = [...new Set(items.map(i => i.source).filter(Boolean))].join('/') || 'walk-in'
          rows.push([e.created_at?.slice(0, 16).replace('T', ' ') || '', e.txn_no || '', 'Sale', '', srcs, items.map(i => (i.name + ' x' + i.qty) + (i.source ? ' [' + i.source + ']' : '')).join('; '), e.total || 0])
        } else {
          const srcs = [...new Set((e.recommended_products || []).map(p => p.source).filter(Boolean))].join('/') || 'walk-in'
          rows.push([(e.consultation_date || '') + ' ' + (e.created_at?.split('T')[1]?.slice(0, 5) || ''), 'Consultation', e.consultation_type || 'skincare', e.provider_name || '', srcs, (e.recommended_products || []).map(p => p.name).join(', '), ''])
        }
      })
    } else if (historyTab === 'sales') {
      rows = [['Txn No', 'Date', 'Payment', 'Total', 'Balance', 'Items']]
      rowsFor.forEach(s => {
        const items = saleItems(s)
        rows.push([s.txn_no || '', s.created_at?.slice(0, 16).replace('T', ' ') || '', s.payment_method || '', s.total || 0, s.balance || 0, items.map(i => (i.name + ' x' + i.qty) + (i.source ? ' [' + i.source + ']' : '')).join('; ')])
      })
    } else if (historyTab === 'appointments') {
      rows = [['Service', 'Date', 'Time', 'Staff', 'Status']]
      rowsFor.forEach(a => rows.push([a.service || '', a.date || '', a.time || '', a.staff_name || '', a.status || '']))
    } else if (historyTab === 'consultations') {
      rows = [['Date', 'Type', 'Provider', 'Sub Type', 'Recommended Products', 'Source']]
      rowsFor.forEach(c => {
        const d = parseC(c)
        const subTypes = (d.type_of_consultation?.selected || []).map(k => PHARMACY_TYPE_LABEL[k]).filter(Boolean)
        const srcs = [...new Set((c.recommended_products || []).map(p => p.source).filter(Boolean))].join('/') || 'walk-in'
        rows.push([c.consultation_date || '', c.consultation_type || 'skincare', c.provider_name || '', subTypes.join(', ') || d.assessment?.skin_type || '', (c.recommended_products || []).map(p => p.name).join(', '), srcs])
      })
    } else {
      rows = [['Date', 'Direction', 'Description', 'Balance']]
      rowsFor.forEach(d => rows.push([d.created_at?.slice(0, 10) || '', d.direction === 'owes_us' ? 'Owes us' : 'We owe', d.description || d.party_name || '', d.balance || 0]))
    }
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_' + selected?.full_name + '_' + historyTab + '.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('History exported as CSV!', { type: 'success' })
  }

  const filtered = clients.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  )

  const matchesFilters = (entry) => {
    const date = entry.kind === 'consultation' ? (entry.consultation_date || '') : (entry.created_at?.slice(0, 10) || '')
    if (filters.dateFrom && date < filters.dateFrom) return false
    if (filters.dateTo && date > filters.dateTo) return false
    if (entry.kind === 'consultation') {
      if (filters.type && entry.consultation_type !== filters.type) return false
      const prods = entry.recommended_products || []
      if (filters.product && !prods.some(p => (p.name || '').toLowerCase().includes(filters.product.toLowerCase()))) return false
      const srcs = prods.map(p => p.source).filter(Boolean)
      if (filters.source) {
        if (filters.source === 'walk-in' ? srcs.length > 0 : !srcs.includes(filters.source)) return false
      }
    } else {
      if (filters.type) return false
      const items = saleItems(entry)
      if (filters.product && !items.some(i => (i.name || '').toLowerCase().includes(filters.product.toLowerCase()))) return false
      if (filters.source) {
        const srcs = items.map(i => i.source).filter(Boolean)
        if (filters.source === 'walk-in' ? srcs.length > 0 : !srcs.includes(filters.source)) return false
      }
    }
    return true
  }

  const filteredHistory = useMemo(() => {
    if (historyTab !== 'timeline' && historyTab !== 'consultations') return history
    return history.filter(matchesFilters)
  }, [history, historyTab, filters])

  // Products the client is "currently on": latest consultation products plus
  // anything sold in the last 30 days, deduped by name (latest source wins).
  const currentOn = useMemo(() => {
    const map = new Map()
    const add = (name, source, date) => {
      const k = (name || '').toLowerCase()
      if (!k) return
      const prev = map.get(k)
      if (!prev || (date || '') >= (prev.date || '')) map.set(k, { name, source: source || 'walk-in', date: date || '' })
    }
    const latest = clientConsults[0]
    ;(latest?.recommended_products || []).forEach(p => add(p.name, p.source, latest.consultation_date))
    const cutoff = Date.now() - 30 * 864e5
    clientSales.forEach(s => {
      if (new Date(s.created_at || 0).getTime() < cutoff) return
      saleItems(s).forEach(i => add(i.name, i.source, s.created_at?.slice(0, 10)))
    })
    return [...map.values()].slice(0, 12)
  }, [clientSales, clientConsults])

  const thisMonth = new Date().toISOString().slice(0, 7)
  const newThisMonth = clients.filter(c => c.created_at?.startsWith(thisMonth)).length
  const totalSpend = clients.reduce((s, c) => s + (c.total_spend || 0), 0)

  return (
    <>
    <style>{`.spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div>
      <SectionHead title='Clients' sub='All your client and patient records' btn='+ Add Client' onBtn={() => setShowAdd(true)}
        extraBtns={[
          { label: 'Upload CSV', icon: <Upload size={14} />, onClick: () => setShowUpload(true) },
          { label: 'Export CSV', icon: <Download size={14} />, onClick: exportCsv },
        ]} />

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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='First Name *' value={form.firstName} onChange={v => f('firstName', v)} placeholder='e.g. Ada' required />
            <Inp label='Surname *' value={form.lastName} onChange={v => f('lastName', v)} placeholder='e.g. Okafor' required />
          </div>
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
              {canConsult && (
                <button onClick={() => navigate('/dashboard/consultation?client=' + selected.id)} title='Start a new consultation for this client'
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: theme.radius.md, background: tealDeep, color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                  <Clipboard size={13} /> New Consultation
                </button>
              )}
            </div>
            {[['Email', selected.email || '—'], ['Gender', selected.gender || '—'], ['Date of Birth', selected.date_of_birth || '—'], ['Address', selected.address || '—'], ['Notes', selected.notes || '—'], ['Joined', selected.created_at?.split('T')[0] || '—']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${gray100}`, fontSize: '13px', gap: 16 }}>
                <span style={{ color: gray500, fontWeight: '600' }}>{l}</span>
                <span style={{ color: navy, textAlign: 'right', maxWidth: '240px' }}>{v}</span>
              </div>
            ))}

            {/* "Currently on" traceability: latest consultation products + last 30 days of sales */}
            {currentOn.length > 0 && (
              <div style={{ marginTop: '18px', padding: '12px 14px', borderRadius: '10px', background: gray100, border: `1px solid ${gray100}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, textTransform: 'uppercase', marginBottom: '8px' }}>Currently On</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '12px', color: navy }}>
                  {currentOn.map(p => (
                    <span key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: theme.radius.full, background: 'white', border: `1px solid ${border}` }}>
                      {p.name}
                      <SourcePill source={p.source} />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Full history across POS, appointments, consultations and debts */}
            <div style={{ marginTop: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase' }}>History</div>
                <button onClick={() => exportHistoryCsv()} title='Export this history as CSV'
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '700', color: gray600 }}>
                  <Download size={12} /> Export
                </button>
              </div>
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

              {(historyTab === 'timeline' || historyTab === 'consultations') && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
                  <input type='date' value={filters.dateFrom} onChange={e => setF('dateFrom', e.target.value)} aria-label='From date'
                    style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '11px', color: navy, background: 'white' }} />
                  <input type='date' value={filters.dateTo} onChange={e => setF('dateTo', e.target.value)} aria-label='To date'
                    style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '11px', color: navy, background: 'white' }} />
                  <select value={filters.source} onChange={e => setF('source', e.target.value)} aria-label='Filter by source'
                    style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '11px', color: navy, background: 'white' }}>
                    <option value=''>All sources</option>
                    <option value='recommended'>Recommended</option>
                    <option value='dispensed'>Dispensed</option>
                    <option value='walk-in'>Walk-in</option>
                  </select>
                  <input value={filters.product} onChange={e => setF('product', e.target.value)} placeholder='Filter by product...' aria-label='Filter by product'
                    style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '11px', color: navy, background: 'white', width: '150px' }} />
                  {historyTab === 'consultations' && (
                    <select value={filters.type} onChange={e => setF('type', e.target.value)} aria-label='Filter by consultation type'
                      style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '11px', color: navy, background: 'white' }}>
                      <option value=''>All types</option>
                      <option value='skincare'>Skincare</option>
                      <option value='pharmacy'>Pharmacy</option>
                    </select>
                  )}
                  {(filters.dateFrom || filters.dateTo || filters.source || filters.product || filters.type) && (
                    <button onClick={() => setFilters({ dateFrom: '', dateTo: '', source: '', product: '', type: '' })} style={{ fontSize: '11px', fontWeight: '700', color: tealDeep, background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>Clear</button>
                  )}
                </div>
              )}

              {historyLoading ? <Loading /> : filteredHistory.length === 0 ? (
                <div style={{ padding: '22px 14px', borderRadius: '10px', background: bg, textAlign: 'center', fontSize: '12px', color: gray500 }}>
                  {history.length > 0 ? 'No history matches your filters.' : historyTab === 'timeline' ? 'No activity yet. Sales and consultations for this client will appear here.' : historyTab === 'sales' ? 'No sales recorded for this client yet. Charge them at the POS and link their name to build history.' : historyTab === 'appointments' ? 'No appointments yet. Book one from Appointments and pick this client.' : historyTab === 'consultations' ? 'No consultations yet. Start one from the Consultations page for this client.' : 'No debts for this client yet. Credit sales and manual debts will appear here.'}
                </div>
              ) : historyTab === 'sales' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {filteredHistory.map(s => <SaleRow key={s.id} s={s} />)}
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
              ) : historyTab === 'consultations' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {filteredHistory.map(c => <ConsultationRow key={c.id} c={c} />)}
                </div>
              ) : historyTab === 'timeline' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                  {filteredHistory.map(e => <TimelineRow key={e.id} e={e} />)}
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

      {/* Upload Clients from Excel / CSV — same flow as the Inventory upload */}
      <Modal show={showUpload} onClose={() => { setShowUpload(false); setUploadData([]); setUploadError('') }} title='Upload Clients from Excel / CSV'>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: '12px', background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '13px', color: tealDeep, lineHeight: '1.9' }}>
            1. Tap <strong>Download Template</strong><br />
            2. Open in <strong>Microsoft Excel</strong> or Google Sheets<br />
            3. Fill in your existing clients / patients row by row<br />
            4. Save as <strong>CSV</strong><br />
            5. Upload here — clients are matched by <strong>phone number</strong>, so repeat customers from the file are skipped, not duplicated
          </div>
          <label style={{ display: 'block', padding: '24px', borderRadius: '12px', border: `2px dashed ${border}`, textAlign: 'center', cursor: 'pointer', background: bg }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', color: gray500 }}><FileUp size={36} /></div>
            <div style={{ fontWeight: '700', color: gray600, fontSize: '14px' }}>Tap to select CSV file</div>
            <input type='file' accept='.csv,.xlsx,.xls,.txt' onChange={handleClientFileUpload} style={{ display: 'none' }} />
          </label>
          {uploadError && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px', borderRadius: '10px', background: dangerBg, border: `1px solid ${danger}`, fontSize: '13px', color: danger }}><AlertTriangle size={15} /> {uploadError}</div>}
          {uploadData.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: success, fontSize: '13px', marginBottom: '8px' }}>
                <CheckCircle size={15} /> {uploadData.length} clients in file
                {uploadData.filter(c => !normPhone(c.phone)).length > 0 && (
                  <span style={{ color: warning, fontWeight: '600' }}> · {uploadData.filter(c => !normPhone(c.phone)).length} missing a phone (will be skipped)</span>
                )}
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: '10px', border: `1px solid ${gray100}` }}>
                {uploadData.map((c, i) => {
                  const missingPhone = !normPhone(c.phone)
                  const isDupe = clients.some(x => normPhone(x.phone) === normPhone(c.phone))
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: `1px solid ${gray100}`, fontSize: '12px', background: missingPhone || isDupe ? warningBg : 'transparent' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600', color: missingPhone || isDupe ? warning : navy }}>
                        {(missingPhone || isDupe) && <AlertTriangle size={12} />}{c.full_name || '(no name)'}
                      </span>
                      <span style={{ color: missingPhone || isDupe ? warning : gray500 }}>
                        {missingPhone ? 'No phone' : isDupe ? 'Already exists' : c.phone + (c.gender ? ' · ' + c.gender : '')}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <GhostBtn onClick={downloadClientTemplate} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Download size={14} /> Download Template</GhostBtn>
            {uploadData.length > 0 && (
              <button onClick={importClients} disabled={importing} style={{ flex: 1, padding: '12px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: '800', fontSize: '14px', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.7 : 1 }}>
                {importing
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Loader2 size={16} className="spin" aria-hidden="true" /> Importing…</span>
                  : 'Import ' + uploadData.length + ' Clients'}
              </button>
            )}
          </div>
        </div>
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
    </>
  )
}
