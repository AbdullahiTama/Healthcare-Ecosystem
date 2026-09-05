import { useState, useEffect, useRef } from 'react'
import { Calendar, Hourglass, CheckCircle, Search, Download, Wallet, Banknote } from 'lucide-react'
import { appointmentRepository } from './repositories'
// Cross-aggregate read: the client list belongs to the clients module. Still
// the shared services/supabase read, used by several unmigrated modules too.
import { getClients, notify, sbFetch } from '../../services/supabase'
import { todayDate } from '../../lib/utils'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Avatar, Empty, DataTable, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, success } = theme

export default function Appointments({ brand, role, perms }) {
  const [appointments, setAppointments] = useState([])
  const [clients, setClients] = useState([])
  const [wallet, setWallet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Paystack return: ?reference=... — verify server-side before showing paid
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference') || params.get('trxref')
    if (!ref) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await authClient.auth.getSession()
        if (!session) return
        const res = await fetch('/api/verify-appointment-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ reference: ref }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        window.history.replaceState({}, '', window.location.pathname)
        if (res.ok) {
          showToast(data.alreadyPaid ? 'Payment already confirmed' : 'Payment confirmed — appointment marked as paid', { type: 'success' })
          load()
        } else {
          showToast(data.error || 'Could not confirm payment. Keep your reference and contact support.', { type: 'error' })
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawForm, setWithdrawForm] = useState({})
  const [withdrawing, setWithdrawing] = useState(false)
  const [banks, setBanks] = useState([])
  const [accountResolving, setAccountResolving] = useState(false)
  const [accountResolved, setAccountResolved] = useState(false)
  const resolveTimer = useRef(null)
  const [form, setForm] = useState({ date: todayDate() })
  const [saving, setSaving] = useState(false)
  const [payLink, setPayLink] = useState(null)
  const [payLinkLoading, setPayLinkLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => {
    let live = true
    getClients(brand.id).then(c => { if (live) setClients(c || []) }).catch(() => {})
    return () => { live = false }
  }, [brand?.id])

  useEffect(() => {
    let live = true
    // Owner wallet read — RLS-scoped to the tenant, so no id filter is needed.
    sbFetch(`business_wallets?business_id=eq.${brand.id}`).then(w => {
      if (live && Array.isArray(w) && w[0]) setWallet(w[0])
    }).catch(() => {})
    return () => { live = false }
  }, [brand?.id])

  useEffect(() => {
    async function loadBanks() {
      try {
        const res = await fetch('/api/banks')
        if (res.ok) {
          const data = await res.json()
          setBanks(data)
        }
      } catch (err) {}
    }
    loadBanks()
  }, [])

  // Resolve account name when bank code and 10-digit account number are both set.
  // Debounced to avoid firing on every keystroke.
  useEffect(() => {
    if (resolveTimer.current) clearTimeout(resolveTimer.current)

    // Clear resolved state when inputs change
    setAccountResolved(false)
    setWithdrawForm(prev => ({ ...prev, accountName: '' }))

    const acctNum = withdrawForm.accountNumber || ''
    const bankCode = withdrawForm.bankCode || ''

    if (!bankCode || acctNum.length !== 10) return

    resolveTimer.current = setTimeout(async () => {
      setAccountResolving(true)
      try {
        const res = await fetch('/api/resolve-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bankCode, accountNumber: acctNum }),
        })
        const data = await res.json()
        if (res.ok && data.accountName) {
          setWithdrawForm(prev => ({ ...prev, accountName: data.accountName }))
          setAccountResolved(true)
        } else if (data.unsupportedBank) {
          setAccountResolved(false)
          showToast(data.error || 'This bank does not support automatic verification. Please enter your account name manually.', { type: 'warning' })
        } else {
          setAccountResolved(false)
          showToast(data.error || data.detail || 'Could not verify account name.', { type: 'error' })
        }
      } catch {
        setAccountResolved(false)
        showToast('Network error. Please check your connection.', { type: 'error' })
      } finally {
        setAccountResolving(false)
      }
    }, 500)

    return () => { if (resolveTimer.current) clearTimeout(resolveTimer.current) }
  }, [withdrawForm.bankCode, withdrawForm.accountNumber])

  async function load() {
    setLoading(true)
    try { const a = await appointmentRepository.getAll(brand.id); setAppointments(a || []); setLoadError('') } catch (e) { setLoadError('Could not load appointments. Check your connection and try again.') }
    setLoading(false)
  }

  // Picking a saved client auto-fills the name and links the record so the
  // appointment appears on the client's history in the customer database.
  function pickClient(name) {
    const c = clients.find(x => x.full_name === name)
    setForm(p => ({ ...p, clientName: name, client_id: c?.id || null }))
  }

  async function save() {
    if (!form.clientName || !form.date || !form.time) { showToast('Please enter client name, date and time.', { type: 'warning' }); return }
    const feeKobo = form.fee ? Math.round(parseFloat(form.fee) * 100) : null
    if (feeKobo && feeKobo > 0 && !form.paymentChannel) { showToast('Select payment channel (cash / POS / transfer / paystack)', { type: 'warning' }); return }
    if (feeKobo && form.paymentChannel === 'pos' && !form.posRef && !confirm('POS reference is empty — proceed without receipt code?')) { /* allow */ }
    setSaving(true)
    try {
      // One channel per appointment — no split. Cash is instant paid, pos/transfer unpaid pending attest, paystack unpaid pending Paystack.
      const ch = feeKobo ? (form.paymentChannel || 'cash') : null
      const paymentStatus = !feeKobo ? null : ch === 'cash' ? 'paid' : 'unpaid'
      const payload = {
        client_id: form.client_id || null,
        client_name: form.clientName,
        service: form.service || '',
        date: form.date,
        time: form.time,
        status: 'pending',
        staff_name: form.staffName || '',
        notes: form.notes || '',
        booking_type: form.bookingType || 'physical',
        source: 'carehub',
        phone: form.phone || '',
        concern: form.concern || null,
        payment_channel: ch,
        consultation_medium: brand?.consultation_medium || null,
        consultation_medium_link: brand?.consultation_medium_link || null,
        fee_amount: feeKobo,
        payment_status: paymentStatus,
        pos_reference: ch === 'pos' ? (form.posRef || null) : null,
        transfer_proof_url: ch === 'transfer' ? (form.transferProofUrl || null) : null,
        // verified audit for cash — attested by creator
        ...(ch === 'cash' && feeKobo ? { verified_at: new Date().toISOString() } : {}),
      }
      const created = await appointmentRepository.create(brand.id, payload)
      // Paystack link: if channel is paystack, immediately request Paystack URL for sharing
      if (ch === 'paystack' && feeKobo && created) {
        // created may be array or object depending on sbFetch; try to get id
        const createdId = Array.isArray(created) ? created[0]?.id : created?.id
        if (createdId) {
          try { await handleSendPaymentLink({ id: createdId, client_name: form.clientName, date: form.date, time: form.time, fee_amount: feeKobo }) } catch {}
          showToast('Appointment booked — paystack link created, share it with the client', { type: 'success' })
        } else {
          showToast('Appointment booked!', { type: 'success' })
        }
      } else if (ch === 'cash' && feeKobo) {
        showToast('Appointment booked — cash marked as paid', { type: 'success' })
      } else if ((ch === 'pos' || ch === 'transfer') && feeKobo) {
        showToast(`Appointment booked — ${ch === 'pos' ? 'POS' : 'transfer'} awaiting staff confirmation`, { type: 'success' })
      } else {
        showToast('Appointment booked!', { type: 'success' })
      }
      setForm({ date: todayDate() }); setShowAdd(false); load()
    } catch (e) { showToast(e.message || 'Could not save appointment. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  function exportCsv() {
    const rows = [['Client', 'Service', 'Date', 'Time', 'Staff', 'Status', 'Notes']]
    appointments.forEach(a => {
      rows.push([a.client_name || '', a.service || '', a.date || '', a.time || '', a.staff_name || '', a.status || '', a.notes || ''])
    })
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Appointments.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Appointments exported as CSV!', { type: 'success' })
  }

  async function updateStatus(id, status) {
    try {
      const appt = appointments.find(a => a.id === id)
      if (!appt) { showToast('Appointment not found.', { type: 'error' }); return }
      // Confirm: flip pending→confirmed. Funds released on completion.
      if (status === 'confirmed' && appt.status === 'pending') {
        const res = await appointmentRepository.confirm(id, brand.id)
        const errMsg = typeof res === 'string' ? res : null
        if (errMsg && errMsg !== 'ok') {
          if (errMsg === 'not_pending') showToast('Only pending appointments can be confirmed.', { type: 'warning' })
          else if (errMsg === 'forbidden') showToast('You do not own this appointment.', { type: 'error' })
          else showToast('Could not confirm appointment. Please try again.', { type: 'error' })
          return
        }
        // Notify patient and refresh wallet
        notify(brand.id, [{ }], 'booking_confirmed', `Appointment confirmed — ${appt.client_name}`, `${appt.date} at ${appt.time}`, '/dashboard/appointments')
        // Refresh wallet balances
        sbFetch(`business_wallets?business_id=eq.${brand.id}`).then(w => {
          if (Array.isArray(w) && w[0]) setWallet(w[0])
        }).catch(() => {})
        load(); showToast('Appointment confirmed.', { type: 'success' })
        return
      }
      // Complete: release held funds to available balance via RPC
      if (status === 'completed' && appt.status === 'confirmed') {
        const res = await appointmentRepository.complete(id, brand.id)
        const errMsg = typeof res === 'string' ? res : null
        if (errMsg && errMsg !== 'ok') {
          if (errMsg === 'not_found') showToast('Appointment not found.', { type: 'error' })
          else if (errMsg === 'not_paid') showToast('Payment not confirmed yet.', { type: 'warning' })
          else showToast('Could not complete appointment. Please try again.', { type: 'error' })
          return
        }
        notify(brand.id, [{ }], 'booking_completed', `Appointment completed — ${appt.client_name}`, `${appt.date} at ${appt.time}`, '/dashboard/appointments')
        sbFetch(`business_wallets?business_id=eq.${brand.id}`).then(w => {
          if (Array.isArray(w) && w[0]) setWallet(w[0])
        }).catch(() => {})
        load(); showToast('Appointment completed — funds released to available balance.', { type: 'success' })
        return
      }
      await appointmentRepository.update(id, brand.id, { status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined, cancelled_at: status === 'cancelled' ? new Date().toISOString() : undefined, completed_at: status === 'completed' ? new Date().toISOString() : undefined })
      load(); showToast('Status updated!', { type: 'success' })
    } catch (e) { showToast(e.message || 'Could not update status. Please try again.', { type: 'error' }) }
  }

  function askDelete(appt) { setDeleteTarget(appt) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await appointmentRepository.delete(id, brand.id); load(); showToast('Appointment deleted.', { type: 'success' }) } catch (e) { showToast('Could not delete appointment. Please try again.', { type: 'error' }) }
  }

  const naira = (kobo) => `₦${((kobo || 0) / 100).toLocaleString()}`

  // ADR-005 payout: owner withdraws the available balance to their bank. The
  // held→available gate is enforced server-side (RPC); the transfer fires
  // immediately from /api/initiate-business-withdrawal.
  async function handleWithdraw() {
    if (!withdrawForm.amount || !withdrawForm.bankName || !withdrawForm.bankCode || !withdrawForm.accountNumber || !withdrawForm.accountName) {
      showToast('Fill in the amount and bank details.', { type: 'warning' }); return
    }
    const amountKobo = Math.round(parseFloat(withdrawForm.amount) * 100)
    if (amountKobo > (wallet?.available_balance || 0)) {
      showToast('Amount exceeds available balance.', { type: 'warning' }); return
    }
    setWithdrawing(true)
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) { showToast('Please log in again.', { type: 'warning' }); setWithdrawing(false); return }
      const res = await fetch('/api/initiate-business-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          business_id: brand.id,
          amount: amountKobo,
          bankCode: withdrawForm.bankCode || '',
          bankName: withdrawForm.bankName,
          accountNumber: withdrawForm.accountNumber,
          accountName: withdrawForm.accountName,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error === 'insufficient' ? 'Not enough available balance to withdraw.' : data.error || 'Could not start withdrawal.', { type: 'error' })
        return
      }
      setWithdrawForm({}); setShowWithdraw(false); setAccountResolved(false)
      // Refresh the wallet balance.
      sbFetch(`business_wallets?business_id=eq.${brand.id}`).then(w => { if (Array.isArray(w) && w[0]) setWallet(w[0]) }).catch(() => {})
      showToast('Withdrawal started — it will arrive shortly.', { type: 'success' })
    } catch (e) {
      showToast('Network error. Please try again.', { type: 'error' })
    }
    setWithdrawing(false)
  }

  async function handleConfirmPos(appt) {
    const ref = prompt('Enter POS receipt reference (last 4-6 digits, optional):', appt.pos_reference || '')
    if (ref === null) return
    const posRef = ref.trim()
    try {
      const res = await appointmentRepository.confirmPos(appt.id, brand.id, posRef || null)
      if (typeof res === 'string' && res !== 'ok') throw new Error(res)
      showToast('POS confirmed — marked as paid', { type: 'success' })
      load()
    } catch (e) {
      const m = String(e.message || '')
      if (m.includes('already_paid')) showToast('Already paid', { type: 'info' })
      else if (m.includes('forbidden')) showToast('You do not own this appointment', { type: 'error' })
      else if (m.includes('wrong_channel')) showToast('Not a POS appointment', { type: 'warning' })
      else showToast(m || 'Could not confirm POS', { type: 'error' })
    }
  }

  async function handleConfirmTransfer(appt) {
    if (!confirm(`Confirm transfer received for ${appt.client_name} — ₦${(appt.fee_amount/100).toLocaleString()}?`)) return
    try {
      const res = await appointmentRepository.confirmTransfer(appt.id, brand.id, null)
      if (typeof res === 'string' && res !== 'ok') throw new Error(res)
      showToast('Transfer confirmed — marked as paid', { type: 'success' })
      load()
    } catch (e) {
      const m = String(e.message || '')
      if (m.includes('already_paid')) showToast('Already paid', { type: 'info' })
      else if (m.includes('forbidden')) showToast('You do not own this appointment', { type: 'error' })
      else showToast(m || 'Could not confirm transfer', { type: 'error' })
    }
  }

  async function handleSendPaymentLink(appt) {
    setPayLink(appt.id)
    setPayLinkLoading(true)
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) { showToast('Please log in again.', { type: 'warning' }); setPayLink(null); return }
      const res = await fetch('/api/initiate-appointment-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ appointment_id: appt.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Could not create payment link.', { type: 'error' })
        setPayLink(null)
        return
      }
      setPayLink({ url: data.authorization_url, ref: data.reference, fee: data.fee, clientName: appt.client_name, date: appt.date, time: appt.time })
      showToast('Payment link created — share it with the client.', { type: 'success' })
    } catch (e) {
      showToast('Network error. Please try again.', { type: 'error' })
      setPayLink(null)
    }
    setPayLinkLoading(false)
  }

  const today = todayDate()
  const filtered = filter === 'all' ? appointments : appointments.filter(a => a.status === filter)
  const todayAppts = appointments.filter(a => a.date === today)
  const pendingCount = appointments.filter(a => a.status === 'pending').length
  const unpaidCount = appointments.filter(a => a.payment_status === 'unpaid').length

  const feeLabel = (kobo) => kobo != null ? `₦${(kobo / 100).toLocaleString()}` : null

  return (
    <div>
      <SectionHead title='Appointments' sub='Manage all bookings and schedules' btn='+ New Appointment' onBtn={() => setShowAdd(true)} extraBtn={{ label: 'Export CSV', icon: <Download size={14} />, onClick: exportCsv }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Calendar />} label='Today' value={todayAppts.length} sub={todayAppts.filter(a => a.status === 'confirmed').length + ' confirmed'} />
        <StatCard icon={<Hourglass />} label='Pending' value={pendingCount} alert={pendingCount > 0} />
        <StatCard icon={<Hourglass />} label='Awaiting payment' value={unpaidCount} alert={unpaidCount > 0} />
        <StatCard icon={<CheckCircle />} label='Total' value={appointments.length} />
      </div>

      {role === 'Owner' && wallet && (
        <Card style={{ marginBottom: '16px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: 40, height: 40, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Wallet size={18} /></div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', letterSpacing: '1px' }}>Booking wallet</div>
              <div style={{ display: 'flex', gap: '16px', marginTop: '2px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12.5px', color: gray600, fontWeight: '600' }}>Available <b style={{ color: success }}>{naira(wallet.available_balance)}</b></span>
                <span style={{ fontSize: '12.5px', color: gray600, fontWeight: '600' }}>Held <b style={{ color: gray500 }}>{naira(wallet.held_balance)}</b></span>
              </div>
            </div>
          </div>
          {wallet.available_balance > 0 && (
            <TealBtn onClick={() => setShowWithdraw(true)}><Banknote size={14} style={{ marginRight: 6 }} />Withdraw</TealBtn>
          )}
        </Card>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['all', 'pending', 'confirmed', 'completed', 'cancelled'].map(s => { const on = filter === s; return (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600, textTransform: 'capitalize' }}>{s}</button>
        )})}
      </div>

      <DataTable
        rows={filtered}
        loading={loading}
        error={loadError}
        onRetry={load}
        empty={<Empty icon={<Calendar size={40} />} message='No appointments found' action='+ Book Appointment' onAction={() => setShowAdd(true)} />}
        count={`${filtered.length} appointment${filtered.length !== 1 ? 's' : ''}`}
        rowStyle={a => ({ background: a.date === today ? tealMist : 'white' })}
        columns={[
          {
            key: 'client_name', label: 'Client', sortable: true,
            render: a => (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Avatar name={a.client_name} size={30} />
                  <span style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{a.client_name}</span>
                  {a.source === 'carefind' && <Pill label='Web' type='blue' />}
                  {a.booking_type === 'online' && <Pill label='Online' type='purple' />}
                </div>
                <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{a.phone ? a.phone : ''}</div>
                {a.booking_type === 'online' && a.consultation_medium && (
                  <div style={{ fontSize: '10px', color: gray400, marginTop: '1px', textTransform: 'capitalize' }}>
                    {a.consultation_medium}{a.consultation_medium_link ? `: ${a.consultation_medium_link}` : ''}
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'concern', label: 'Concern', sortable: true,
            render: a => a.concern
              ? <span style={{ display: 'block', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', color: gray600 }} title={a.concern}>{a.concern}</span>
              : <span style={{ color: gray400 }}>—</span>,
          },
          { key: 'service', label: 'Service', sortable: true, render: a => <span style={{ fontSize: '13px', color: gray600 }}>{a.service || '—'}</span> },
          { key: 'date', label: 'Date', sortable: true, render: a => <span style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{a.date}</span> },
          { key: 'time', label: 'Time', sortable: true, render: a => <span style={{ fontSize: '13px', color: gray600 }}>{a.time}</span> },
          {
            key: 'payment_status', label: 'Payment', sortable: true,
            render: a => (
              <>
                {a.payment_status === 'paid' && !a.released_at && <Pill label={`Held ${feeLabel(a.fee_amount)}`} type='amber' />}
                {a.payment_status === 'paid' && a.released_at && <Pill label={`Available ${feeLabel(a.fee_amount)}`} type='green' />}
                {a.payment_status === 'unpaid' && <Pill label='Unpaid' type='red' />}
                {a.payment_status === 'refunded' && <Pill label='Refunded' type='gray' />}
                {!a.payment_status && <span style={{ color: gray400 }}>—</span>}
                {a.payment_channel && <div style={{ marginTop: '3px', fontSize: '10px', color: gray400, textTransform: 'capitalize' }}>{a.payment_channel}</div>}
              </>
            ),
          },
          {
            key: 'status', label: 'Status', sortable: true,
            render: a => <Pill label={a.status} type={a.status === 'confirmed' ? 'green' : a.status === 'completed' ? 'teal' : a.status === 'cancelled' ? 'red' : 'amber'} />,
          },
        ]}
        actions={a => (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {a.status === 'pending' && <button onClick={() => updateStatus(a.id, 'confirmed')} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: success, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Confirm</button>}
            {a.status === 'confirmed' && <button onClick={() => updateStatus(a.id, 'completed')} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Complete</button>}
            {a.status !== 'cancelled' && a.status !== 'completed' && <button onClick={() => updateStatus(a.id, 'cancelled')} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: dangerBg, color: danger, fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>}
            {a.payment_status === 'unpaid' && a.payment_channel === 'pos' && a.fee_amount && (
              <button onClick={() => handleConfirmPos(a)} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Confirm POS</button>
            )}
            {a.payment_status === 'unpaid' && a.payment_channel === 'transfer' && a.fee_amount && (
              <button onClick={() => handleConfirmTransfer(a)} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Confirm Transfer</button>
            )}
            {a.payment_status === 'unpaid' && a.fee_amount && (a.payment_channel === 'paystack' || !a.payment_channel || a.payment_channel === 'card') && (
              <button onClick={() => handleSendPaymentLink(a)} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>
                {payLinkLoading && payLink === a.id ? 'Sending...' : 'Pay Link'}
              </button>
            )}
            {perms?.canDelete && <RedBtn onClick={() => askDelete(a)} style={{ padding: '4px 9px', fontSize: '11px' }}>Del</RedBtn>}
          </div>
        )}
      />

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ date: todayDate() }) }} title='New Appointment'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ date: todayDate() }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Book Appointment'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Client Name *</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input list='appt-clients' value={form.clientName || ''} onChange={e => pickClient(e.target.value)} placeholder='Pick a saved client or type a name...'
                style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
              <datalist id='appt-clients'>
                {clients.map(c => <option key={c.id} value={c.full_name} />)}
              </datalist>
            </div>
          </div>
          <Inp label='Service' value={form.service} onChange={v => f('service', v)} placeholder='e.g. Facial Treatment, Consultation' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Date *' value={form.date} onChange={v => f('date', v)} type='date' required />
            <Inp label='Time *' value={form.time} onChange={v => f('time', v)} type='time' required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Sel label='Booking type' value={form.bookingType || 'physical'} onChange={v => f('bookingType', v)} options={[{ value: 'physical', label: 'Physical visit' }, { value: 'online', label: 'Online (video/phone)' }]} />
            <Sel label='Payment channel *' value={form.paymentChannel || 'cash'} onChange={v => f('paymentChannel', v)} options={[{ value: 'cash', label: 'Cash — instant paid' }, { value: 'pos', label: 'POS — confirm after terminal' }, { value: 'transfer', label: 'Transfer — confirm after receipt' }, { value: 'paystack', label: 'Paystack link — pay online' }]} />
          </div>
          {form.paymentChannel === 'pos' && form.fee && (
            <Inp label='POS reference (optional)' value={form.posRef || ''} onChange={v => f('posRef', v)} placeholder='Last 4-6 digits of receipt' />
          )}
          {form.fee && <div style={{ fontSize: 11, color: gray400, marginTop: -8, marginBottom: 4 }}>{form.paymentChannel === 'cash' ? 'Cash: will be marked paid immediately.' : form.paymentChannel === 'pos' ? 'POS: appointment stays unpaid until you tap Confirm POS after terminal approval.' : form.paymentChannel === 'transfer' ? 'Transfer: stays unpaid until you tap Confirm Transfer.' : form.paymentChannel === 'paystack' ? 'Paystack: a shareable link will be created — client pays online, you are notified when confirmed.' : ''}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Client Phone' value={form.phone} onChange={v => f('phone', v)} placeholder='08012345678' />
            <Inp label='Assigned Staff' value={form.staffName} onChange={v => f('staffName', v)} placeholder='Staff / therapist name' />
          </div>
          <Inp label='Fee (₦, optional)' type='number' value={form.fee || ''} onChange={v => f('fee', v)} placeholder='0' min='0' step='100' />
          <Textarea label='Client concern' value={form.concern} onChange={v => f('concern', v)} placeholder='What is the client coming in for?' rows={2} />
          <Textarea label='Notes' value={form.notes} onChange={v => f('notes', v)} placeholder='Any special notes or instructions...' rows={2} />
        </div>
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Delete this appointment?'
        consequence={`This permanently removes ${deleteTarget?.client_name ? `${deleteTarget.client_name}'s` : 'this'} appointment from your records. This cannot be undone. If you just need to cancel it, use Cancel instead.`}
        confirmLabel='Delete' />

      <Modal show={showWithdraw} onClose={() => { setShowWithdraw(false); setAccountResolved(false); setWithdrawForm({}) }} title='Withdraw booking balance'
        footer={<><GhostBtn onClick={() => { setShowWithdraw(false); setAccountResolved(false); setWithdrawForm({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={handleWithdraw} disabled={withdrawing || (!accountResolved && !withdrawForm.accountName) || (withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0))} style={{ flex: 1, padding: '12px', opacity: (withdrawing || (!accountResolved && !withdrawForm.accountName) || (withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0))) ? 0.6 : 1 }}>{withdrawing ? 'Withdrawing...' : 'Withdraw'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '12.5px', color: gray600 }}>
            Available balance: <b style={{ color: success }}>{naira(wallet?.available_balance)}</b>. Money is sent straight to the bank account below via Paystack.
          </p>
          <Inp label='Amount (₦)' type='number' value={withdrawForm.amount || ''} onChange={v => setWithdrawForm(p => ({ ...p, amount: v }))} placeholder='e.g. 5000' min='1' max={Math.floor((wallet?.available_balance ?? 0) / 100)} required />
          {withdrawForm.amount && Math.round(parseFloat(withdrawForm.amount) * 100) > (wallet?.available_balance || 0) && (
            <span style={{ fontSize: '11px', color: danger, fontWeight: '700' }}>Amount exceeds available balance of {naira(wallet?.available_balance)}</span>
          )}
          <label style={{ fontSize: '12px', fontWeight: '700', color: gray600, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            Bank *
            <select
              value={withdrawForm.bankCode || ''}
              onChange={e => {
                const bank = banks.find(b => b.code === e.target.value)
                setWithdrawForm(p => ({ ...p, bankCode: e.target.value, bankName: bank ? bank.name : '' }))
              }}
              required
              style={{
                padding: '10px 12px', fontSize: '13px', borderRadius: '8px',
                border: `1px solid ${border}`, background: '#fff',
                color: navy, fontFamily: 'inherit',
              }}
            >
              <option value="">Select your bank</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
            {banks.length === 0 && (
              <span style={{ fontSize: '11px', color: gray400 }}>Loading banks...</span>
            )}
          </label>
          <Inp label='Account number' value={withdrawForm.accountNumber || ''} onChange={v => setWithdrawForm(p => ({ ...p, accountNumber: String(v || '').replace(/\D/g, '').slice(0, 10) }))} placeholder='10 digits' inputMode='numeric' pattern='[0-9]*' required />
          <div>
            <Inp
              label={accountResolving ? 'Account name (verifying...)' : 'Account name'}
              value={withdrawForm.accountName || ''}
              onChange={v => setWithdrawForm(p => ({ ...p, accountName: v }))}
              placeholder={accountResolving ? 'Verifying account...' : 'Select bank and enter account number'}
              readOnly={accountResolved || accountResolving}
              required
              style={accountResolved ? { background: success + '10', borderColor: success } : undefined}
            />
            {accountResolving && (
              <span style={{ fontSize: '11px', color: gray400 }}>Verifying account name with your bank...</span>
            )}
            {accountResolved && withdrawForm.accountName && (
              <span style={{ fontSize: '11px', color: success, fontWeight: '700' }}>✓ Account name verified</span>
            )}
            {!accountResolved && !accountResolving && withdrawForm.bankCode && (withdrawForm.accountNumber || '').length === 10 && (
              <span style={{ fontSize: '11px', color: warning, fontWeight: '700' }}>Automatic verification unavailable for this bank. Please enter your account name manually.</span>
            )}
          </div>
        </div>
      </Modal>

      {payLink && typeof payLink === 'object' && (
        <Modal show={true} onClose={() => setPayLink(null)} title='Payment Link'
          footer={<><GhostBtn onClick={() => setPayLink(null)} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn><TealBtn onClick={() => navigator.clipboard.writeText(payLink.url).then(() => showToast('Link copied!', { type: 'success' }))} style={{ flex: 1, padding: '12px' }}>Copy Link</TealBtn></>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: gray600 }}>Share this link with <b>{payLink.clientName}</b> for the appointment on {payLink.date} at {payLink.time}.</p>
            <p style={{ margin: 0, fontSize: '12px', color: gray500 }}>Amount: <b>{naira(payLink.fee)}</b></p>
            <div style={{ padding: '12px', background: theme.gray50, borderRadius: theme.radius.md, border: `1px solid ${border}`, wordBreak: 'break-all', fontSize: '12px', fontFamily: theme.fontMono, color: navy }}>{payLink.url}</div>
            <p style={{ margin: 0, fontSize: '11px', color: gray400 }}>The client pays via Paystack. You'll be notified when payment is confirmed.</p>
          </div>
        </Modal>
      )}

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
