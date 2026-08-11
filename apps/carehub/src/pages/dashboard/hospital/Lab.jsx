import { useState, useEffect } from 'react'
import { ArrowLeft, Microscope, CheckCircle, Bell, RefreshCw, MessageCircle } from 'lucide-react'
import { useAuth } from '../../../providers/AuthProvider'
import { getPatients, updatePatient, getLabRequests, getLabResults, addLabResult, updateLabRequest, addPatientMessage, getPatientMessages } from '../../../services/supabase'
import { fmt, todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, Avatar, Loading, Empty, useToast, Toast } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, successBg, warning, warningBg, info, infoBg, bg } = theme

const COMMON_TESTS = [
  { name: 'Malaria RDT', type: 'result', options: ['Positive', 'Negative'] },
  { name: 'Full Blood Count (FBC)', type: 'text' },
  { name: 'Packed Cell Volume (PCV)', type: 'number', unit: '%' },
  { name: 'Blood Sugar (Fasting)', type: 'number', unit: 'mmol/L' },
  { name: 'Blood Sugar (Random)', type: 'number', unit: 'mmol/L' },
  { name: 'Widal Test', type: 'result', options: ['Positive', 'Negative', 'Borderline'] },
  { name: 'Hepatitis B Surface Antigen', type: 'result', options: ['Positive', 'Negative'] },
  { name: 'HIV Screening', type: 'result', options: ['Positive', 'Negative'] },
  { name: 'Urinalysis', type: 'text' },
  { name: 'Stool Analysis', type: 'text' },
  { name: 'Blood Culture', type: 'text' },
  { name: 'Liver Function Test (LFT)', type: 'text' },
  { name: 'Kidney Function Test (KFT)', type: 'text' },
  { name: 'Lipid Profile', type: 'text' },
  { name: 'Thyroid Function Test', type: 'text' },
  { name: 'Pregnancy Test (urine)', type: 'result', options: ['Positive', 'Negative'] },
  { name: 'Blood Group & Genotype', type: 'text' },
  { name: 'ESR', type: 'number', unit: 'mm/hr' },
  { name: 'Other', type: 'text' },
]

export default function Lab({ brand }) {
  const { auth } = useAuth()
  const staffName = auth?.staff ? auth.staff.full_name : (auth?.brand?.owner || 'Lab Technician')
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [results, setResults] = useState({})
  const [summary, setSummary] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('pending')
  const { msg, show: showToast } = useToast()

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try { const r = await getLabRequests(brand.id); setRequests(r || []) } catch (e) {}
    setLoading(false)
  }

  async function openRequest(req) {
    setSelected(req)
    setResults({})
    setSummary('')
    setMessage('')
    try {
      const msgs = await getPatientMessages(req.patient_id)
      setMessages(msgs || [])
    } catch (e) {}
  }

  async function submitResults() {
    if (!selected) return
    setSaving(true)
    try {
      const testsOrdered = JSON.parse(selected.tests || '[]')
      const resultsList = testsOrdered.map(test => ({
        test_name: test.name || test,
        result: results[test.name || test] || '',
        unit: test.unit || '',
        normal_range: test.normal_range || '',
      }))

      await addLabResult({
        lab_request_id: selected.id,
        patient_id: selected.patient_id,
        business_id: brand.id,
        performed_by: staffName,
        results: JSON.stringify(resultsList),
        summary: summary,
        status: 'completed',
      })

      await updateLabRequest(selected.id, { status: 'completed' })

      // Send message to doctor
      await addPatientMessage({
        patient_id: selected.patient_id,
        business_id: brand.id,
        sender_name: staffName,
        sender_role: 'Lab Technician',
        department: 'Laboratory',
        message: 'Lab results uploaded for patient. ' + (summary ? 'Summary: ' + summary : ''),
        message_type: 'lab_result',
      })

      showToast('Results submitted and sent to Doctor!')
      setSelected(null)
      load()
    } catch (e) { showToast('Error saving results. Please try again.') }
    setSaving(false)
  }

  async function sendMessage() {
    if (!message.trim() || !selected) return
    try {
      await addPatientMessage({
        patient_id: selected.patient_id,
        business_id: brand.id,
        sender_name: staffName,
        sender_role: 'Lab Technician',
        department: 'Laboratory',
        message: message.trim(),
        message_type: 'note',
      })
      setMessage('')
      const msgs = await getPatientMessages(selected.patient_id)
      setMessages(msgs || [])
      showToast('Message sent!')
    } catch (e) {}
  }

  const pending = requests.filter(r => r.status === 'pending')
  const completed = requests.filter(r => r.status === 'completed')
  const filtered = tab === 'pending' ? pending : completed

  if (selected) {
    let tests = []
    try { tests = JSON.parse(selected.tests || '[]') } catch (e) {}

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <button onClick={() => setSelected(null)} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
          <div>
            <div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>Lab Request — {selected.patient_name || 'Patient'}</div>
            <div style={{ fontSize: '12px', color: gray400 }}>Requested by: {selected.requested_by} · {selected.created_at?.split('T')[0]}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600', marginBottom: '16px' }}>
          <Microscope size={14} /> Lab Module · Performed by: <strong>{staffName}</strong> — Your name will be attached to all results
        </div>

        {selected.notes && (
          <Card style={{ padding: '14px', marginBottom: '14px', background: warningBg, border: `1px solid ${warning}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: warning, marginBottom: '4px' }}>Doctor's Notes</div>
            <div style={{ fontSize: '13px', color: gray600 }}>{selected.notes}</div>
          </Card>
        )}

        {selected.status === 'pending' && (
          <Card style={{ padding: '20px', marginBottom: '16px' }}>
            <div style={{ fontSize: '15px', fontWeight: '800', marginBottom: '16px', color: navy }}>Enter Test Results</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {tests.map((test, i) => {
                const testName = test.name || test
                const testDef = COMMON_TESTS.find(t => t.name === testName)
                return (
                  <div key={i} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: bg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: '700', fontSize: '13px', marginBottom: '8px', color: navy }}><Microscope size={14} color={tealDeep} /> {testName}</div>
                    {testDef?.type === 'result' ? (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {testDef.options.map(opt => (
                          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${results[testName] === opt ? tealDeep : border}`, background: results[testName] === opt ? tealMist : 'white', cursor: 'pointer', fontSize: '13px' }}>
                            <input type='radio' checked={results[testName] === opt} onChange={() => setResults(prev => ({ ...prev, [testName]: opt }))} style={{ accentColor: tealDeep }} />
                            <span style={{ fontWeight: results[testName] === opt ? '700' : '400', color: results[testName] === opt ? (opt === 'Positive' ? danger : success) : gray600 }}>{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : testDef?.type === 'number' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type='number' value={results[testName] || ''} onChange={e => setResults(prev => ({ ...prev, [testName]: e.target.value }))}
                          placeholder='Enter value' style={{ flex: 1, padding: '9px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy }} />
                        {testDef.unit && <span style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>{testDef.unit}</span>}
                      </div>
                    ) : (
                      <textarea value={results[testName] || ''} onChange={e => setResults(prev => ({ ...prev, [testName]: e.target.value }))}
                        placeholder='Enter result...' rows={2}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', color: navy, fontFamily: theme.fontFamily }} />
                    )}
                  </div>
                )
              })}
              <Textarea label='Overall Summary / Interpretation' value={summary} onChange={setSummary} placeholder='Overall interpretation of results, recommendations...' rows={3} />
            </div>
            <button onClick={submitResults} disabled={saving}
              style={{ width: '100%', marginTop: '16px', padding: '14px', borderRadius: theme.radius.md, border: 'none', background: saving ? theme.gray200 : tealDeep, color: saving ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {saving ? 'Submitting...' : <><CheckCircle size={16} /> Submit Results & Send to Doctor →</>}
            </button>
          </Card>
        )}

        {selected.status === 'completed' && (
          <Card style={{ padding: '16px', marginBottom: '16px', background: successBg, border: `1px solid ${success}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: success, fontSize: '14px' }}><CheckCircle size={15} /> Results already submitted for this request</div>
          </Card>
        )}

        {/* Communication thread */}
        <Card style={{ padding: '20px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}><MessageCircle size={16} color={tealDeep} /> Communication with Doctor</div>
          <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: gray400, fontSize: '13px', padding: '20px' }}>No messages yet</div>
            ) : messages.map(m => { const isLab = m.sender_role === 'Lab Technician'; return (
              <div key={m.id} style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: isLab ? tealMist : infoBg, border: `1px solid ${isLab ? tealMist : infoBg}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: isLab ? tealDeep : info }}>{m.sender_name} — {m.sender_role}</span>
                  <span style={{ fontSize: '10px', color: gray400 }}>{m.created_at?.replace('T', ' ').slice(0, 16)}</span>
                </div>
                <div style={{ fontSize: '13px', color: navy }}>{m.message}</div>
              </div>
            )})}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={message} onChange={e => setMessage(e.target.value)} placeholder='Send message to Doctor...'
              style={{ flex: 1, padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy }}
              onKeyDown={e => e.key === 'Enter' && sendMessage()} />
            <TealBtn onClick={sendMessage} style={{ padding: '9px 16px' }}>Send</TealBtn>
          </div>
        </Card>

        <Toast msg={msg} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Laboratory</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Lab requests from doctors · Logged in as: <strong>{staffName}</strong></div>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}><RefreshCw size={13} /> Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Microscope />} label='Pending Tests' value={pending.length} alert={pending.length > 0} />
        <StatCard icon={<CheckCircle />} label='Completed Today' value={completed.length} />
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '14px 18px', borderRadius: theme.radius.lg, background: tealMist, border: `1px solid ${tealMist}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Bell size={20} color={tealDeep} style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: '700', color: tealDeep, fontSize: '14px' }}>{pending.length} lab request(s) waiting!</div>
            <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>{pending.map(r => r.patient_name || 'Patient').join(' · ')}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['pending', 'completed'].map(t => { const on = tab === t; return (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontWeight: '700', fontSize: '13px', background: on ? tealDeep : 'white', color: on ? 'white' : gray600, textTransform: 'capitalize' }}>{t}</button>
        )})}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Microscope size={40} />} message={tab === 'pending' ? 'No pending lab requests' : 'No completed tests yet'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(req => {
            let tests = []
            try { tests = JSON.parse(req.tests || '[]') } catch (e) {}
            return (
              <Card key={req.id} style={{ padding: '16px', cursor: 'pointer', border: req.status === 'pending' ? `1px solid ${tealDeep}` : `1px solid ${border}` }} onClick={() => openRequest(req)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Microscope size={20} /></div>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{req.patient_name || 'Patient'}</div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{tests.length} test(s) · Requested by: {req.requested_by}</div>
                      <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{req.created_at?.replace('T', ' ').slice(0, 16)}</div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                        {tests.slice(0, 4).map((t, i) => <span key={i} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: theme.radius.sm, background: tealMist, color: tealDeep, fontWeight: '600' }}>{t.name || t}</span>)}
                        {tests.length > 4 && <span style={{ fontSize: '10px', color: gray400 }}>+{tests.length - 4} more</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <Pill label={req.status === 'pending' ? 'Pending' : 'Completed'} type={req.status === 'pending' ? 'amber' : 'green'} />
                    {req.priority === 'urgent' && <Pill label='URGENT' type='red' />}
                    <span style={{ fontSize: '12px', color: tealDeep, fontWeight: '600' }}>Open →</span>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Toast msg={msg} />
    </div>
  )
}
