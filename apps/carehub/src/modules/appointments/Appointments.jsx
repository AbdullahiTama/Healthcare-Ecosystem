import { useState, useEffect } from 'react'
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
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawForm, setWithdrawForm] = useState({})
  const [withdrawing, setWithdrawing] = useState(false)
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
    setSaving(true)
    try {
      const feeKobo = form.fee ? Math.round(parseFloat(form.fee) * 100) : null
      await appointmentRepository.create(brand.id, {
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
        // ADR-005: CareHub bookings are settled in person. The channel is
        // recorded for the business's own books; the medium is snapshotted
        // from the business default so online consultations always carry it.
        payment_channel: form.paymentChannel || 'cash',
        consultation_medium: brand?.consultation_medium || null,
        consultation_medium_link: brand?.consultation_medium_link || null,
        fee_amount: feeKobo,
        payment_status: feeKobo ? 'unpaid' : null,
      })
      showToast('Appointment booked!', { type: 'success' })
      setForm({ date: todayDate() }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save appointment. Please try again.', { type: 'error' }) }
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
    setWithdrawing(true)
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) { showToast('Please log in again.', { type: 'warning' }); return }
      const res = await fetch('/api/initiate-business-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          business_id: brand.id,
          amount: Math.round(parseFloat(withdrawForm.amount) * 100),
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
      setWithdrawForm({}); setShowWithdraw(false)
      // Refresh the wallet balance.
      sbFetch(`business_wallets?business_id=eq.${brand.id}`).then(w => { if (Array.isArray(w) && w[0]) setWallet(w[0]) }).catch(() => {})
      showToast('Withdrawal started — it will arrive shortly.', { type: 'success' })
    } catch (e) {
      showToast('Network error. Please try again.', { type: 'error' })
    }
    setWithdrawing(false)
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
            {a.payment_status === 'unpaid' && a.fee_amount && (
              <button onClick={() => handleSendPaymentLink(a)} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>
                {payLinkLoading && payLink === a.id ? 'Sending...' : 'Send Pay Link'}
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
            <Sel label='Payment channel' value={form.paymentChannel || 'cash'} onChange={v => f('paymentChannel', v)} options={[{ value: 'cash', label: 'Cash' }, { value: 'transfer', label: 'Transfer' }, { value: 'pos', label: 'POS' }, { value: 'credit', label: 'Credit' }]} />
          </div>
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

      <Modal show={showWithdraw} onClose={() => setShowWithdraw(false)} title='Withdraw booking balance'
        footer={<><GhostBtn onClick={() => setShowWithdraw(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={handleWithdraw} style={{ flex: 1, padding: '12px' }}>{withdrawing ? 'Withdrawing...' : 'Withdraw'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '12.5px', color: gray600 }}>
            Available balance: <b style={{ color: success }}>{naira(wallet?.available_balance)}</b>. Money is sent straight to the bank account below via Paystack.
          </p>
          <Inp label='Amount (₦)' type='number' value={withdrawForm.amount || ''} onChange={v => setWithdrawForm(p => ({ ...p, amount: v }))} placeholder='e.g. 5000' required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Bank name' value={withdrawForm.bankName || ''} onChange={v => setWithdrawForm(p => ({ ...p, bankName: v }))} placeholder='e.g. Access Bank' required />
            <Inp label='Bank code' value={withdrawForm.bankCode || ''} onChange={v => setWithdrawForm(p => ({ ...p, bankCode: v }))} placeholder='3-digit Paystack code' required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Account number' value={withdrawForm.accountNumber || ''} onChange={v => setWithdrawForm(p => ({ ...p, accountNumber: v }))} placeholder='10 digits' required />
            <Inp label='Account name' value={withdrawForm.accountName || ''} onChange={v => setWithdrawForm(p => ({ ...p, accountName: v }))} placeholder='Name on account' required />
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
