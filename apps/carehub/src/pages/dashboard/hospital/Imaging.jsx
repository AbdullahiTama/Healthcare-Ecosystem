import { useState, useEffect } from 'react'
import { ArrowLeft, Scan, CheckCircle, Bell, RefreshCw, MessageCircle, Lightbulb } from 'lucide-react'
import { useAuth } from '../../../providers/AuthProvider'
import { getImagingRequests, updateImagingRequest, addPatientMessage, getPatientMessages } from '../../../services/supabase'
import { theme } from '../../../styles/theme'
import { Card, StatCard, Inp, Sel, Textarea, GhostBtn, TealBtn, Loading, Empty, StatusBadge, useToast, Toast } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, success, warning, warningBg, info, infoBg, bg } = theme

const SCAN_TYPES = ['X-ray', 'Ultrasound (USS)', 'CT Scan', 'MRI', 'Echocardiogram', 'Mammogram', 'DEXA Scan', 'Fluoroscopy', 'Other']
const BODY_PARTS = ['Chest', 'Abdomen', 'Pelvis', 'Head / Brain', 'Spine', 'Upper Limb', 'Lower Limb', 'Neck', 'Breast', 'Heart', 'Full Body', 'Other']

export default function Imaging({ brand }) {
  const { auth } = useAuth()
  const staffName = auth?.staff ? auth.staff.full_name : (auth?.brand?.owner || 'Radiographer')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [report, setReport] = useState('')
  const [reportUrl, setReportUrl] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('pending')
  const { msg, show: showToast } = useToast()

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try { const r = await getImagingRequests(brand.id); setRequests(r || []) } catch (e) {}
    setLoading(false)
  }

  async function openRequest(req) {
    setSelected(req); setReport(''); setReportUrl(''); setMessage('')
    try { const msgs = await getPatientMessages(req.patient_id); setMessages(msgs || []) } catch (e) {}
  }

  async function submitReport() {
    if (!report.trim()) { showToast('Please enter the imaging report'); return }
    setSaving(true)
    try {
      await updateImagingRequest(selected.id, {
        report,
        report_url: reportUrl || '',
        performed_by: staffName,
        status: 'completed',
      })
      await addPatientMessage({
        patient_id: selected.patient_id,
        business_id: brand.id,
        sender_name: staffName,
        sender_role: 'Radiographer',
        department: 'Imaging',
        message: selected.scan_type + ' report uploaded. ' + report.slice(0, 100) + (report.length > 100 ? '...' : ''),
        message_type: 'imaging_result',
      })
      showToast('Report submitted and sent to Doctor!')
      setSelected(null); load()
    } catch (e) { showToast('Error saving report.') }
    setSaving(false)
  }

  async function sendMessage() {
    if (!message.trim() || !selected) return
    try {
      await addPatientMessage({
        patient_id: selected.patient_id,
        business_id: brand.id,
        sender_name: staffName,
        sender_role: 'Radiographer',
        department: 'Imaging',
        message: message.trim(),
        message_type: 'note',
      })
      setMessage('')
      const msgs = await getPatientMessages(selected.patient_id)
      setMessages(msgs || [])
    } catch (e) {}
  }

  const pending = requests.filter(r => r.status === 'pending')
  const completed = requests.filter(r => r.status === 'completed')
  const filtered = tab === 'pending' ? pending : completed

  if (selected) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={() => setSelected(null)} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
        <div>
          <div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>Imaging Request — {selected.patient_name || 'Patient'}</div>
          <div style={{ fontSize: '12px', color: gray400 }}>Requested by: {selected.requested_by} · {selected.created_at?.split('T')[0]}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600', marginBottom: '16px' }}>
        <Scan size={14} /> Imaging Module · Performed by: <strong>{staffName}</strong>
      </div>

      <Card style={{ padding: '16px', marginBottom: '14px', background: bg }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '10px' }}>Request Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[['Scan Type', selected.scan_type || '—'], ['Body Part', selected.body_part || '—'], ['Requested By', selected.requested_by || '—'], ['Priority', selected.priority || 'Routine'], ['Date', selected.created_at?.split('T')[0] || '—'], ['Status', selected.status]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: '10px', color: gray400, fontWeight: '700' }}>{l}</div><div style={{ fontSize: '12px', fontWeight: '600', color: navy }}>{v}</div></div>
          ))}
        </div>
        {selected.clinical_info && (
          <div style={{ marginTop: '10px', padding: '10px', borderRadius: theme.radius.sm, background: warningBg, border: `1px solid ${warning}`, fontSize: '12px', color: navy }}>
            <strong>Clinical Information:</strong> {selected.clinical_info}
          </div>
        )}
      </Card>

      {selected.status === 'pending' && (
        <Card style={{ padding: '20px', marginBottom: '14px' }}>
          <div style={{ fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}>Upload Report</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Textarea label='Imaging Report / Findings *' value={report} onChange={setReport}
              placeholder={'Enter ' + (selected.scan_type || 'imaging') + ' findings and interpretation...'} rows={6} />
            <Inp label='Report / Image URL (optional)' value={reportUrl} onChange={setReportUrl}
              placeholder='Link to scanned image or PDF report...' />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
              <Lightbulb size={13} /> After submitting, the Doctor will immediately see this report on the patient file
            </div>
          </div>
          <button onClick={submitReport} disabled={saving}
            style={{ width: '100%', marginTop: '16px', padding: '14px', borderRadius: theme.radius.md, border: 'none', background: saving ? theme.gray200 : tealDeep, color: saving ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {saving ? 'Submitting...' : <><CheckCircle size={16} /> Submit Report & Send to Doctor →</>}
          </button>
        </Card>
      )}

      {selected.status === 'completed' && selected.report && (
        <Card style={{ padding: '16px', marginBottom: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: '800', marginBottom: '8px', color: navy }}>Report Submitted</div>
          <div style={{ fontSize: '13px', color: gray600, lineHeight: '1.7' }}>{selected.report}</div>
          {selected.report_url && <a href={selected.report_url} target='_blank' rel='noreferrer' style={{ display: 'inline-block', marginTop: '10px', color: tealDeep, fontWeight: '700', fontSize: '13px' }}>View Image/PDF →</a>}
          <div style={{ marginTop: '10px', fontSize: '12px', color: gray500 }}>Performed by: {selected.performed_by}</div>
        </Card>
      )}

      <Card style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}><MessageCircle size={16} color={tealDeep} /> Communication with Doctor</div>
        <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: gray400, fontSize: '13px', padding: '16px' }}>No messages yet</div>
          ) : messages.map(m => { const isImaging = m.department === 'Imaging'; return (
            <div key={m.id} style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: isImaging ? tealMist : infoBg, border: `1px solid ${isImaging ? tealMist : infoBg}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: isImaging ? tealDeep : info }}>{m.sender_name} — {m.sender_role}</span>
                <span style={{ fontSize: '10px', color: gray400 }}>{m.created_at?.replace('T', ' ').slice(0, 16)}</span>
              </div>
              <div style={{ fontSize: '13px', color: navy }}>{m.message}</div>
            </div>
          )})}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={message} onChange={e => setMessage(e.target.value)} placeholder='Message to Doctor...'
            style={{ flex: 1, padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy }}
            onKeyDown={e => e.key === 'Enter' && sendMessage()} />
          <TealBtn onClick={sendMessage} style={{ padding: '9px 16px' }}>Send</TealBtn>
        </div>
      </Card>
      <Toast msg={msg} />
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Imaging / Radiology</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Scan requests from doctors · Logged in as: <strong>{staffName}</strong></div>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Scan />} label='Pending Scans' value={pending.length} alert={pending.length > 0} />
        <StatCard icon={<CheckCircle />} label='Completed' value={completed.length} />
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '14px 18px', borderRadius: theme.radius.lg, background: tealMist, border: `1px solid ${tealMist}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Bell size={20} color={tealDeep} style={{ flexShrink: 0 }} />
          <div><div style={{ fontWeight: '700', color: tealDeep, fontSize: '14px' }}>{pending.length} scan request(s) waiting!</div></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['pending', 'completed'].map(t => { const on = tab === t; return (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontWeight: '700', fontSize: '13px', background: on ? tealDeep : 'white', color: on ? 'white' : gray600, textTransform: 'capitalize' }}>{t}</button>
        )})}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Scan size={40} />} message={tab === 'pending' ? 'No pending scan requests' : 'No completed scans yet'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(req => (
            <Card key={req.id} style={{ padding: '16px', cursor: 'pointer', border: req.status === 'pending' ? `1px solid ${tealDeep}` : `1px solid ${border}` }} onClick={() => openRequest(req)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Scan size={20} /></div>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{req.patient_name || 'Patient'}</div>
                    <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{req.scan_type} — {req.body_part}</div>
                    <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>Requested by: {req.requested_by} · {req.created_at?.split('T')[0]}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                  <StatusBadge status={req.status} />
                  <span style={{ fontSize: '12px', color: tealDeep, fontWeight: '600' }}>Open →</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Toast msg={msg} />
    </div>
  )
}
