import { useState, useEffect } from 'react'
import { Calendar, Hourglass, CheckCircle, Search, Download } from 'lucide-react'
import { getAppointments, addAppointment, updateAppointment, deleteAppointment, getClients } from '../../services/supabase'
import { todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Avatar, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, success } = theme

export default function Appointments({ brand, role, perms }) {
  const [appointments, setAppointments] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ date: todayDate() })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => {
    let live = true
    getClients(brand.id).then(c => { if (live) setClients(c || []) }).catch(() => {})
    return () => { live = false }
  }, [brand?.id])

  async function load() {
    setLoading(true)
    try { const a = await getAppointments(brand.id); setAppointments(a || []) } catch (e) {}
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
      await addAppointment({
        business_id: brand.id,
        client_id: form.client_id || null,
        client_name: form.clientName,
        service: form.service || '',
        date: form.date,
        time: form.time,
        status: 'pending',
        staff_name: form.staffName || '',
        notes: form.notes || '',
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
    try { await updateAppointment(id, { status }); load(); showToast('Status updated!', { type: 'success' }) } catch (e) { showToast('Could not update status. Please try again.', { type: 'error' }) }
  }

  function askDelete(appt) { setDeleteTarget(appt) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await deleteAppointment(id); load(); showToast('Appointment deleted.', { type: 'success' }) } catch (e) { showToast('Could not delete appointment. Please try again.', { type: 'error' }) }
  }

  const today = todayDate()
  const filtered = filter === 'all' ? appointments : appointments.filter(a => a.status === filter)
  const todayAppts = appointments.filter(a => a.date === today)
  const pendingCount = appointments.filter(a => a.status === 'pending').length

  return (
    <div>
      <SectionHead title='Appointments' sub='Manage all bookings and schedules' btn='+ New Appointment' onBtn={() => setShowAdd(true)} extraBtn={{ label: 'Export CSV', icon: <Download size={14} />, onClick: exportCsv }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Calendar />} label='Today' value={todayAppts.length} sub={todayAppts.filter(a => a.status === 'confirmed').length + ' confirmed'} />
        <StatCard icon={<Hourglass />} label='Pending' value={pendingCount} alert={pendingCount > 0} />
        <StatCard icon={<CheckCircle />} label='Total' value={appointments.length} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['all', 'pending', 'confirmed', 'completed', 'cancelled'].map(s => { const on = filter === s; return (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600, textTransform: 'capitalize' }}>{s}</button>
        )})}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Calendar size={40} />} message='No appointments found' action='+ Book Appointment' onAction={() => setShowAdd(true)} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Client', 'Service', 'Date', 'Time', 'Staff', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${gray100}`, background: a.date === today ? tealMist : 'white' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Avatar name={a.client_name} size={30} />
                        <span style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{a.client_name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray600 }}>{a.service || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: '700', color: navy }}>{a.date}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray600 }}>{a.time}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray500 }}>{a.staff_name || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <Pill label={a.status} type={a.status === 'confirmed' ? 'green' : a.status === 'completed' ? 'teal' : a.status === 'cancelled' ? 'red' : 'amber'} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                        {a.status === 'pending' && <button onClick={() => updateStatus(a.id, 'confirmed')} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: success, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Confirm</button>}
                        {a.status === 'confirmed' && <button onClick={() => updateStatus(a.id, 'completed')} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Complete</button>}
                        {a.status !== 'cancelled' && a.status !== 'completed' && <button onClick={() => updateStatus(a.id, 'cancelled')} style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: dangerBg, color: danger, fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Cancel</button>}
                        {perms?.canDelete && <RedBtn onClick={() => askDelete(a)} style={{ padding: '4px 9px', fontSize: '11px' }}>Del</RedBtn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
          <Inp label='Assigned Staff' value={form.staffName} onChange={v => f('staffName', v)} placeholder='Staff / therapist name' />
          <Textarea label='Notes' value={form.notes} onChange={v => f('notes', v)} placeholder='Any special notes or instructions...' rows={2} />
        </div>
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Delete this appointment?'
        consequence={`This permanently removes ${deleteTarget?.client_name ? `${deleteTarget.client_name}'s` : 'this'} appointment from your records. This cannot be undone. If you just need to cancel it, use Cancel instead.`}
        confirmLabel='Delete' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
