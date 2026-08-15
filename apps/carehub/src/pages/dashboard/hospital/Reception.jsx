import { useState, useEffect } from 'react'
import { ArrowLeft, UserCheck, CheckCircle, Bell, Users, Hourglass, BedDouble, ArrowUpRight, Siren, Search as SearchIcon } from 'lucide-react'
import { getPatients, addPatient, updatePatient } from '../../../services/supabase'
import { todayDate, genId } from '../../../lib/utils'
import { NIG_STATES } from '../../../config/constants'
import { theme } from '../../../styles/theme'
import { Card, StatCard, SectionHead, Inp, Sel, GhostBtn, TealBtn, Avatar, Loading, Empty, ErrorState, Pill, useToast, Toast } from '../.././../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, gray50, border, success, warning, warningBg, info, infoBg } = theme

function StatusBadge({ status }) {
  const map = {
    at_reception: { label: 'At Reception', type: 'blue' },
    at_triage: { label: 'At Triage', type: 'amber' },
    at_doctor: { label: 'With Doctor', type: 'purple' },
    at_pharmacy: { label: 'At Pharmacy', type: 'teal' },
    at_lab: { label: 'At Lab / Imaging', type: 'purple' },
    discharged: { label: 'Discharged', type: 'green' },
    admitted: { label: 'Admitted', type: 'red' },
    referred: { label: 'Referred Out', type: 'purple' },
    transferred: { label: 'Emergency Transfer', type: 'red' },
  }
  const s = map[status] || { label: status || 'Unknown', type: 'gray' }
  return <Pill label={s.label} type={s.type} />
}

export default function Reception({ brand }) {
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState('list')
  const [form, setForm] = useState({ regDate: todayDate(), regNo: genId('REG') })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const DEPTS = ['General OPD', 'Emergency', 'Cardiology', 'Pediatrics', 'Obstetrics', 'Surgery', 'Orthopedics', 'ENT', 'Ophthalmology', 'Dermatology', 'Psychiatry', 'Neurology', 'Other']

  // Global search across all departments — server-side ilike on name, reg no,
  // phone, department and doctor, so any staff member can pull up a patient
  // who is elsewhere in the hospital.
  useEffect(() => {
    if (!brand?.id) return
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const p = await getPatients(brand.id, { query: searchTerm.trim(), department: deptFilter || undefined })
        setPatients(p || []); setLoadError('')
      } catch (e) { setLoadError('Could not load patients. Check your connection and try again.') }
      setSearching(false)
    }, 300)
    return () => { clearTimeout(t); setSearching(false) }
  }, [brand?.id, searchTerm, deptFilter])

  async function load() {
    setLoading(true)
    try { const p = await getPatients(brand.id); setPatients(p || []); setLoadError('') } catch (e) { setLoadError('Could not load patients. Check your connection and try again.') }
    setLoading(false)
  }

  async function register() {
    if (!form.patName || !form.phone) { showToast('Please enter patient name and phone number.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await addPatient({
        business_id: brand.id,
        reg_no: form.regNo,
        full_name: form.patName,
        date_of_birth: form.dob || '',
        gender: form.gender || '',
        phone: form.phone,
        address: form.address || '',
        next_of_kin: form.nokName || '',
        next_of_kin_phone: form.nokPhone || '',
        insurance: form.insurance || 'None',
        pay_status: form.payStatus || 'Pending',
        department: form.dept || '',
        assigned_doctor: form.doctor || '',
        status: 'at_triage',
      })
      setSaved(true)
      load()
    } catch (e) { showToast('Could not save patient. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  if (view === 'new' && !saved) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={() => setView('list')} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
        <div><div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>New Patient Registration</div><div style={{ fontSize: '12px', color: gray400 }}>Reception — data flows to Triage and Doctor automatically</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: theme.radius.md, background: infoBg, border: `1px solid ${info}`, fontSize: '12px', color: info, fontWeight: '600', marginBottom: '16px' }}>
        <UserCheck size={14} /> Data entered here will automatically appear for the Nurse and Doctor
      </div>
      <Card style={{ padding: '20px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '15px', fontWeight: '800', color: navy }}>Patient Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Registration No.' value={form.regNo} onChange={v => f('regNo', v)} />
            <Inp label='Registration Date' value={form.regDate} onChange={v => f('regDate', v)} type='date' />
          </div>
          <Inp label='Full Name *' value={form.patName} onChange={v => f('patName', v)} placeholder='Patient full name' required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Date of Birth' value={form.dob} onChange={v => f('dob', v)} type='date' />
            <Sel label='Gender' value={form.gender} onChange={v => f('gender', v)} options={['Male', 'Female', 'Other']} />
          </div>
          <Inp label='Phone Number *' value={form.phone} onChange={v => f('phone', v)} placeholder='08012345678' required />
          <Inp label='Home Address' value={form.address} onChange={v => f('address', v)} placeholder='Full home address' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Next of Kin Name' value={form.nokName} onChange={v => f('nokName', v)} placeholder='Full name' />
            <Inp label='Next of Kin Phone' value={form.nokPhone} onChange={v => f('nokPhone', v)} placeholder='Phone number' />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Sel label='Department' value={form.dept} onChange={v => f('dept', v)} options={DEPTS} />
            <Inp label='Assigned Doctor' value={form.doctor} onChange={v => f('doctor', v)} placeholder='Dr. Name' />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Sel label='Insurance / HMO' value={form.insurance} onChange={v => f('insurance', v)} options={['None / Self-pay', 'NHIS', 'PHIS', 'Leadway', 'Aiico', 'Hygeia', 'Reliance', 'AXA Mansard', 'Other']} />
            <Sel label='Payment Status' value={form.payStatus} onChange={v => f('payStatus', v)} options={['Paid', 'Pending', 'Insurance', 'Waived']} />
          </div>
        </div>
      </Card>
      <button onClick={register} disabled={saving}
        style={{ width: '100%', padding: '14px', borderRadius: theme.radius.md, border: 'none', background: saving ? theme.gray200 : tealDeep, color: saving ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving...' : 'Register Patient & Send to Triage →'}
      </button>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )

  if (saved) return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><CheckCircle size={48} color={success} /></div>
      <div style={{ fontSize: '22px', fontWeight: '900', marginBottom: '8px', color: navy }}>Patient Registered!</div>
      <div style={{ fontSize: '14px', color: gray500, marginBottom: '12px' }}><strong>{form.patName}</strong> has been registered successfully</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: theme.radius.full, background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: warning, fontWeight: '700', marginBottom: '24px' }}>
        <Bell size={14} /> Patient sent to Triage — Nurse can now see this patient
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <TealBtn onClick={() => { setForm({ regDate: todayDate(), regNo: genId('REG') }); setSaved(false) }}>Register Another Patient</TealBtn>
        <GhostBtn onClick={() => { setSaved(false); setView('list') }}>Back to Patient List</GhostBtn>
      </div>
    </div>
  )

  return (
    <div>
      <SectionHead title='Reception' sub='Register patients and send to triage' btn='+ Register New Patient' onBtn={() => { setForm({ regDate: todayDate(), regNo: genId('REG') }); setSaved(false); setView('new') }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '14px', marginBottom: '20px' }}>
        <StatCard icon={<Users />} label='Total Today' value={patients.length} />
        <StatCard icon={<Hourglass />} label='At Triage' value={patients.filter(p => p.status === 'at_triage').length} />
        <StatCard icon={<CheckCircle />} label='Discharged' value={patients.filter(p => p.status === 'discharged').length} />
        <StatCard icon={<BedDouble />} label='Admitted' value={patients.filter(p => p.status === 'admitted').length} />
        <StatCard icon={<ArrowUpRight />} label='Referred Out' value={patients.filter(p => p.status === 'referred').length} />
        <StatCard icon={<Siren />} label='Emergency Transfer' value={patients.filter(p => p.status === 'transferred').length} />
      </div>
      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : patients.length === 0 ? <Empty icon={<Users size={40} />} message={searching ? 'Searching…' : searchTerm || deptFilter ? 'No patients match your search' : 'No patients today'} action='+ Register First Patient' onAction={() => setView('new')} /> : (
        <Card>
          <div style={{ display: 'flex', gap: '10px', padding: '14px 14px 0 14px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <SearchIcon size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: gray400 }} />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder='Search any patient — name, reg no, phone, department or doctor…'
                style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', boxSizing: 'border-box', color: navy, fontFamily: theme.fontFamily }} />
            </div>
            <Sel label='' value={deptFilter} onChange={v => setDeptFilter(v)} options={DEPTS} style={{ minWidth: 180 }} placeholder='All departments' />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                {['Reg No.', 'Patient', 'Phone', 'Department', 'Doctor', 'Status'].map(h => <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>{patients.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500, fontWeight: '600' }}>{p.reg_no}</td>
                  <td style={{ padding: '12px 14px' }}><div style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{p.full_name}</div><div style={{ fontSize: '11px', color: gray400 }}>{p.gender || ''} {p.date_of_birth ? '· DOB: ' + p.date_of_birth : ''}</div></td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: gray600 }}>{p.phone}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: gray600 }}>{p.department || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: gray600 }}>{p.assigned_doctor || '—'}</td>
                  <td style={{ padding: '12px 14px' }}><StatusBadge status={p.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
