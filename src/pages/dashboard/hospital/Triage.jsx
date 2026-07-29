// Triage.jsx
import { useState, useEffect } from 'react'
import { ArrowLeft, Activity, AlertTriangle, CheckCircle, Bell } from 'lucide-react'
import { getPatients, addTriage, updatePatient, getTriage } from '../../../services/supabase'
import { theme } from '../../../styles/theme'
import { Card, SectionHead, Inp, Textarea, GhostBtn, TealBtn, Avatar, Loading, Empty, Pill, useToast, Toast } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray500, gray400, gray100, border, danger, dangerBg, success, warning, warningBg } = theme

function StatusBadge({ status }) {
  const map = { at_triage: { label: 'At Triage', type: 'amber' }, at_doctor: { label: 'With Doctor', type: 'purple' }, at_pharmacy: { label: 'At Pharmacy', type: 'teal' }, discharged: { label: 'Discharged', type: 'green' } }
  const s = map[status] || { label: status || '—', type: 'gray' }
  return <Pill label={s.label} type={s.type} />
}

export default function Triage({ brand }) {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try { const p = await getPatients(brand.id); setPatients((p || []).filter(x => x.status === 'at_triage')) } catch (e) {}
    setLoading(false)
  }

  async function sendToDoctor() {
    if (!selected) return
    setSaving(true)
    try {
      await addTriage({ patient_id: selected.id, business_id: brand.id, weight: form.weight || '', height: form.height || '', bp: form.bp || '', pulse: form.pulse || '', temperature: form.temp || '', rr: form.rr || '', spo2: form.spo2 || '', blood_sugar: form.bs || '', chief_complaint: form.complaint || '', allergies: form.allergies || '', nurse_name: form.nurseName || '', status: 'done' })
      await updatePatient(selected.id, { status: 'at_doctor' })
      setDone(true); load()
    } catch (e) { showToast('Could not save triage vitals. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  if (selected && !done) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={() => setSelected(null)} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
        <div><div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>Triage — {selected.full_name}</div><div style={{ fontSize: '12px', color: gray400 }}>{selected.reg_no} · {selected.department || 'General OPD'}</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: '12px', color: warning, fontWeight: '600', marginBottom: '16px' }}>
        <Activity size={14} /> Nurse Module — Vitals saved here go directly to the Doctor
      </div>
      <Card style={{ padding: '16px', marginBottom: '14px', background: tealMist, border: `1px solid ${tealMist}` }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: tealDeep, marginBottom: '8px' }}>Patient Info — From Reception</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[['Name', selected.full_name], ['Phone', selected.phone], ['DOB', selected.date_of_birth || '—'], ['Gender', selected.gender || '—'], ['Department', selected.department || '—'], ['Doctor', selected.assigned_doctor || '—'], ['Insurance', selected.insurance || '—'], ['Payment', selected.pay_status || '—']].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: '10px', color: gray500, fontWeight: '700' }}>{l}</div><div style={{ fontSize: '12px', fontWeight: '600', color: navy }}>{v}</div></div>
          ))}
        </div>
      </Card>
      <Card style={{ padding: '20px', marginBottom: '16px' }}>
        <div style={{ fontSize: '15px', fontWeight: '800', marginBottom: '16px', color: navy }}>Vital Signs</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Inp label='Weight (kg)' value={form.weight} onChange={v => f('weight', v)} placeholder='e.g. 68' />
          <Inp label='Height (cm)' value={form.height} onChange={v => f('height', v)} placeholder='e.g. 170' />
          <Inp label='Blood Pressure' value={form.bp} onChange={v => f('bp', v)} placeholder='e.g. 120/80 mmHg' />
          <Inp label='Pulse (bpm)' value={form.pulse} onChange={v => f('pulse', v)} placeholder='e.g. 72' />
          <Inp label='Temperature (°C)' value={form.temp} onChange={v => f('temp', v)} placeholder='e.g. 37.2' />
          <Inp label='Respiratory Rate' value={form.rr} onChange={v => f('rr', v)} placeholder='e.g. 16/min' />
          <Inp label='Oxygen Saturation' value={form.spo2} onChange={v => f('spo2', v)} placeholder='e.g. 98%' />
          <Inp label='Blood Sugar (optional)' value={form.bs} onChange={v => f('bs', v)} placeholder='e.g. 5.6 mmol/L' />
        </div>
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Textarea label='Chief Complaint' value={form.complaint} onChange={v => f('complaint', v)} placeholder="Patient's main complaint in brief..." rows={2} />
          <Textarea label='Allergies (if any)' value={form.allergies} onChange={v => f('allergies', v)} placeholder='Known allergies...' rows={2} />
          {form.allergies && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: theme.radius.sm, background: dangerBg, border: `1px solid ${danger}`, fontSize: '12px', color: danger, fontWeight: '700' }}><AlertTriangle size={13} /> ALLERGY ALERT: {form.allergies}</div>}
          <Inp label='Nurse Name' value={form.nurseName} onChange={v => f('nurseName', v)} placeholder='Your name' />
        </div>
      </Card>
      <button onClick={sendToDoctor} disabled={saving}
        style={{ width: '100%', padding: '14px', borderRadius: theme.radius.md, border: 'none', background: saving ? theme.gray200 : tealDeep, color: saving ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving...' : 'Save Vitals & Send to Doctor →'}
      </button>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )

  if (done) return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><CheckCircle size={48} color={success} /></div>
      <div style={{ fontSize: '22px', fontWeight: '900', marginBottom: '8px', color: navy }}>Triage Complete!</div>
      <div style={{ fontSize: '14px', color: gray500, marginBottom: '12px' }}>Vitals saved for <strong>{selected.full_name}</strong></div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: theme.radius.full, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '13px', color: tealDeep, fontWeight: '700', marginBottom: '24px' }}>
        <Bell size={14} /> Patient sent to Doctor — Doctor can now see full file
      </div>
      <div><TealBtn onClick={() => { setSelected(null); setDone(false); setForm({}); load() }}>Back to Patient List</TealBtn></div>
    </div>
  )

  return (
    <div>
      <SectionHead title='Triage' sub='Patients waiting for nurse assessment' />
      {loading ? <Loading /> : patients.length === 0 ? (
        <Empty icon={<Activity size={40} />} message='No patients at triage right now' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {patients.map(p => (
            <Card key={p.id} style={{ padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <Avatar name={p.full_name} size={44} />
                <div>
                  <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{p.full_name}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{p.reg_no} · {p.phone}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{p.department || 'General OPD'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <StatusBadge status={p.status} />
                <TealBtn onClick={() => { setSelected(p); setForm({}); setDone(false) }}>Start Triage</TealBtn>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
