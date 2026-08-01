import { useState, useEffect } from 'react'
import { ArrowLeft, Stethoscope, AlertTriangle, Pill as PillIcon, Microscope, Scan, Send, MessageCircle, CheckCircle, Check, Plus, Search as SearchIcon } from 'lucide-react'
import { useAuth } from '../../../providers/AuthProvider'
import { getPatients, getTriage, addHospitalConsultation, addPrescription, updatePatient, addLabRequest, addImagingRequest, getPatientMessages, addPatientMessage } from '../../../services/supabase'
import { fmt } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Card, SectionHead, Inp, Sel, Textarea, GhostBtn, TealBtn, Avatar, Loading, Empty, Pill, useToast, Toast } from '../../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, success, successBg, warning, warningBg, info, infoBg, bg } = theme

export default function Doctor({ brand, products }) {
  const { auth } = useAuth()
  const staffName = auth?.staff ? auth.staff.full_name : (auth?.brand?.owner || 'Doctor')
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [triageData, setTriageData] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [labResults, setLabResults] = useState([])
  const [consult, setConsult] = useState({})
  const [meds, setMeds] = useState([])
  const [medSearch, setMedSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [sentTo, setSentTo] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  // Destinations — doctor can select multiple
  const [destinations, setDestinations] = useState({ pharmacy: false, lab: false, imaging: false })
  // Lab tests to order
  const [labTests, setLabTests] = useState([])
  const [labTestInput, setLabTestInput] = useState('')
  // Imaging requests
  const [imagingRequests, setImagingRequests] = useState([{ scan_type: '', body_part: '', clinical_info: '' }])
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const c = (k, v) => setConsult(p => ({ ...p, [k]: v }))

  useEffect(() => {
    const t = setTimeout(() => { load() }, 300)
    return () => clearTimeout(t)
  }, [brand?.id, searchTerm])

  async function load() {
    setLoading(true)
    try {
      // Global search: when the doctor searches, pull matching patients from
      // EVERY department; otherwise show the at_doctor queue as before.
      const q = searchTerm.trim()
      const p = await getPatients(brand.id, { status: q ? undefined : 'at_doctor', query: q })
      setPatients(p || [])
    } catch (e) {}
    setLoading(false)
  }

  async function openPatient(p) {
    setSelected(p); setConsult({}); setMeds([]); setDone(false); setSentTo([])
    setDestinations({ pharmacy: false, lab: false, imaging: false })
    setLabTests([]); setLabTestInput('')
    setImagingRequests([{ scan_type: '', body_part: '', clinical_info: '' }])
    try {
      const [t, msgs] = await Promise.all([getTriage(p.id), getPatientMessages(p.id)])
      setTriageData(t)
      setMessages(msgs || [])
    } catch (e) {}
  }

  const medicines = (products || []).filter(p => (p.cat || p.category) === 'Medicines' && (p.name.toLowerCase().includes(medSearch.toLowerCase()) || (p.generic_name || '').toLowerCase().includes(medSearch.toLowerCase())))
  const addMed = m => { setMeds(prev => [...prev, { ...m, dose: '', freq: '', dur: '', route: 'Oral', instructions: '' }]); setMedSearch('') }
  const updMed = (i, k, v) => setMeds(prev => prev.map((m, j) => j === i ? { ...m, [k]: v } : m))

  async function sendToPharmacy() {
    if (!consult.dx1) { showToast('Please enter at least a primary diagnosis.', { type: 'warning' }); return }
    if (!destinations.pharmacy && !destinations.lab && !destinations.imaging) {
      showToast('Please select at least one destination — Pharmacy, Lab or Imaging.', { type: 'warning' }); return
    }
    setSaving(true)
    try {
      const sentDestinations = []
      // Save consultation with doctor name
      const c = await addHospitalConsultation({
        patient_id: selected.id,
        business_id: brand.id,
        hpi: consult.hpi || '',
        examination: consult.exam || '',
        primary_diagnosis: consult.dx1 || '',
        secondary_diagnosis: consult.dx2 || '',
        clinical_notes: consult.notes || '',
        disposition: consult.disposition || 'Discharge',
        referral_dest: consult.refDest || '',
        referral_reason: consult.refReason || '',
        ward: consult.ward || '',
        counselling: consult.counselling || '',
        doctor_name: staffName,
        performed_by: staffName,
        status: 'completed',
      })

      // Send to Pharmacy
      if (destinations.pharmacy && meds.length > 0) {
        await addPrescription({
          patient_id: selected.id,
          consultation_id: (c[0] || {}).id || null,
          business_id: brand.id,
          patient_name: selected.full_name,
          doctor_name: staffName,
          medicines: JSON.stringify(meds),
          lab_tests: consult.labTests || '',
          imaging: consult.imaging || '',
          notes: consult.prescNotes || '',
          status: 'pending',
        })
        sentDestinations.push('pharmacy')
      }

      // Send to Lab
      if (destinations.lab && labTests.length > 0) {
        await addLabRequest({
          patient_id: selected.id,
          business_id: brand.id,
          consultation_id: (c[0] || {}).id || null,
          patient_name: selected.full_name,
          requested_by: staffName,
          tests: JSON.stringify(labTests.map(t => ({ name: t }))),
          status: 'pending',
          priority: consult.labPriority || 'routine',
          notes: consult.labNotes || '',
        })
        sentDestinations.push('lab')
      }

      // Send to Imaging
      if (destinations.imaging) {
        for (const img of imagingRequests.filter(i => i.scan_type)) {
          await addImagingRequest({
            patient_id: selected.id,
            business_id: brand.id,
            consultation_id: (c[0] || {}).id || null,
            patient_name: selected.full_name,
            requested_by: staffName,
            scan_type: img.scan_type,
            body_part: img.body_part || '',
            clinical_info: img.clinical_info || consult.dx1 || '',
            status: 'pending',
          })
        }
        sentDestinations.push('imaging')
      }

      // Determine patient next status — disposition (Admit/Refer/Emergency Transfer)
      // takes priority over destination routing, since it's the actual clinical
      // outcome; destinations still create their own department work queues above,
      // independent of the patient's own status.
      let nextStatus
      if (consult.disposition === 'Admit') nextStatus = 'admitted'
      else if (consult.disposition === 'Refer to Specialist') nextStatus = 'referred'
      else if (consult.disposition === 'Emergency Transfer') nextStatus = 'transferred'
      else {
        nextStatus = 'discharged'
        if (sentDestinations.includes('lab') || sentDestinations.includes('imaging')) nextStatus = 'at_lab'
        else if (sentDestinations.includes('pharmacy')) nextStatus = 'at_pharmacy'
      }
      await updatePatient(selected.id, { status: nextStatus })

      // Send message to communication thread
      await addPatientMessage({
        patient_id: selected.id,
        business_id: brand.id,
        sender_name: staffName,
        sender_role: 'Doctor',
        department: 'Consultation',
        message: 'Consultation complete. Diagnosis: ' + consult.dx1 + '. Sent to: ' + sentDestinations.join(', '),
        message_type: 'consultation',
      })

      setSentTo(sentDestinations)
      setDone(true)
      load()
    } catch (e) { showToast('Could not save consultation. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  if (selected && !done) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button onClick={() => setSelected(null)} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
        <div><div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>Doctor Consultation</div><div style={{ fontSize: '12px', color: gray400 }}>{selected.full_name} · {selected.reg_no}</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600', marginBottom: '14px' }}>
        <Stethoscope size={14} /> Patient info auto-filled from Reception and Triage
      </div>
      <Card style={{ padding: '14px', marginBottom: '14px', background: bg }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '10px' }}>Patient Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          {[['Name', selected.full_name], ['Reg No.', selected.reg_no], ['Gender', selected.gender || '—'], ['DOB', selected.date_of_birth || '—'], ['Department', selected.department || '—'], ['Doctor', selected.assigned_doctor || '—'], ['Insurance', selected.insurance || '—']].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: '10px', color: gray400, fontWeight: '700' }}>{l}</div><div style={{ fontSize: '12px', fontWeight: '600', color: navy }}>{v}</div></div>
          ))}
        </div>
        {triageData && (
          <>
            <div style={{ borderTop: `1px solid ${border}`, paddingTop: '10px', marginTop: '4px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Vitals from Nurse</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '6px' }}>
                {[['BP', triageData.bp], ['Pulse', triageData.pulse], ['Temp', triageData.temperature], ['SpO2', triageData.spo2], ['Weight', triageData.weight], ['Height', triageData.height]].filter(([, v]) => v).map(([l, v]) => (
                  <div key={l} style={{ padding: '5px 8px', borderRadius: theme.radius.sm, background: 'white', border: `1px solid ${border}` }}>
                    <div style={{ fontSize: '9px', color: gray400, fontWeight: '700' }}>{l}</div>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: navy }}>{v}</div>
                  </div>
                ))}
              </div>
              {triageData.chief_complaint && <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: theme.radius.sm, background: 'white', border: `1px solid ${border}`, fontSize: '12px', color: navy }}><strong>Chief Complaint:</strong> {triageData.chief_complaint}</div>}
              {triageData.allergies && <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', padding: '8px 10px', borderRadius: theme.radius.sm, background: dangerBg, border: `1px solid ${danger}`, fontSize: '12px', color: danger, fontWeight: '700' }}><AlertTriangle size={12} /> ALLERGY: {triageData.allergies}</div>}
            </div>
          </>
        )}
      </Card>
      <Card style={{ padding: '20px', marginBottom: '14px' }}>
        <div style={{ fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}>Clinical Assessment</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Textarea label='History of Present Illness' value={consult.hpi} onChange={v => c('hpi', v)} placeholder='Onset, duration, severity, progression, associated symptoms...' rows={4} />
          <Textarea label='Physical Examination Findings' value={consult.exam} onChange={v => c('exam', v)} placeholder='General appearance, systemic examination...' rows={3} />
          <Inp label='Primary Diagnosis *' value={consult.dx1} onChange={v => c('dx1', v)} placeholder='e.g. Hypertensive crisis, Malaria, Peptic Ulcer Disease' required />
          <Inp label='Secondary Diagnosis (optional)' value={consult.dx2} onChange={v => c('dx2', v)} placeholder='Additional diagnosis...' />
          <Textarea label='Clinical Notes' value={consult.notes} onChange={v => c('notes', v)} placeholder='Additional observations...' rows={2} />
          <Inp label='Doctor Name' value={consult.doctorName} onChange={v => c('doctorName', v)} placeholder='Your name' />
        </div>
      </Card>
      <Card style={{ padding: '20px', marginBottom: '14px' }}>
        <div style={{ fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}>Prescription — Sends to Pharmacy</div>
        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <input value={medSearch} onChange={e => setMedSearch(e.target.value)} placeholder='Search medicines from inventory...'
            style={{ width: '100%', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', boxSizing: 'border-box', color: navy }} />
          {medSearch && medicines.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, boxShadow: theme.elevation[3], zIndex: 10, marginTop: '4px', overflow: 'hidden' }}>
              {medicines.map(m => (
                <button key={m.id} onClick={() => addMed(m)} style={{ width: '100%', padding: '10px 14px', border: 'none', background: 'white', cursor: 'pointer', textAlign: 'left', borderBottom: `1px solid ${gray100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '13px', color: navy }}><PillIcon size={13} color={tealDeep} /> {m.name}</div><div style={{ fontSize: '11px', color: gray500 }}>{m.generic_name || ''} · {m.stock} in stock</div></div>
                  <span style={{ color: tealDeep, fontWeight: '700', fontSize: '12px' }}>+ Add</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {meds.length === 0 ? <div style={{ textAlign: 'center', padding: '14px', color: gray400, fontSize: '13px', border: `1px dashed ${border}`, borderRadius: theme.radius.md }}>Search and add medicines above</div>
          : meds.map((med, idx) => (
            <div key={idx} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, marginBottom: '10px', background: bg }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '13px', color: navy }}><PillIcon size={14} color={tealDeep} /> {med.name}</div>
                <button onClick={() => setMeds(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: danger, fontWeight: '700', fontSize: '12px' }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <Inp label='Dose' value={med.dose} onChange={v => updMed(idx, 'dose', v)} placeholder='e.g. 500mg' />
                <Inp label='Frequency' value={med.freq} onChange={v => updMed(idx, 'freq', v)} placeholder='e.g. Twice daily' />
                <Inp label='Duration' value={med.dur} onChange={v => updMed(idx, 'dur', v)} placeholder='e.g. 5 days' />
                <Sel label='Route' value={med.route} onChange={v => updMed(idx, 'route', v)} options={['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Sublingual', 'Rectal', 'Other']} />
              </div>
              <div style={{ marginTop: '8px' }}><Inp label='Instructions' value={med.instructions} onChange={v => updMed(idx, 'instructions', v)} placeholder='e.g. Take after meals' /></div>
            </div>
          ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
          <Textarea label='Lab Tests Ordered' value={consult.labTests} onChange={v => c('labTests', v)} placeholder='FBC, LFT, Malaria RDT...' rows={2} />
          <Textarea label='Imaging Requested' value={consult.imaging} onChange={v => c('imaging', v)} placeholder='Chest X-ray, USS...' rows={2} />
        </div>
      </Card>
      <Card style={{ padding: '20px', marginBottom: '14px' }}>
        <div style={{ fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}>Disposition & Follow-up</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {['Discharge', 'Admit', 'Refer to Specialist', 'Emergency Transfer'].map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${consult.disposition === v ? tealDeep : border}`, background: consult.disposition === v ? tealMist : 'white', cursor: 'pointer', fontSize: '13px', color: navy }}>
              <input type='radio' checked={consult.disposition === v} onChange={() => c('disposition', v)} style={{ accentColor: tealDeep }} />{v}
            </label>
          ))}
        </div>
        {consult.disposition === 'Admit' && <Inp label='Ward / Bed' value={consult.ward} onChange={v => c('ward', v)} placeholder='e.g. Male Medical Ward, Bed 5' />}
        {consult.disposition === 'Refer to Specialist' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <Inp label='Referral Destination' value={consult.refDest} onChange={v => c('refDest', v)} placeholder='e.g. LUTH Cardiology' />
          <Textarea label='Reason' value={consult.refReason} onChange={v => c('refReason', v)} rows={2} />
        </div>}
        <Textarea label='Patient Counselling & Instructions' value={consult.counselling} onChange={v => c('counselling', v)} placeholder='Diet, lifestyle, medication compliance...' rows={2} />
        <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Inp label='Follow-up Date' value={consult.fuDate} onChange={v => c('fuDate', v)} type='date' />
          <Sel label='Follow-up Clinic' value={consult.fuClinic} onChange={v => c('fuClinic', v)} options={['Same Doctor', 'General OPD', 'Cardiology', 'Pediatrics', 'Surgery', 'Other']} />
        </div>
      </Card>
      {/* Destination Selection */}
      <Card style={{ padding: '20px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}><Send size={16} color={tealDeep} /> Send Patient To</div>
        <div style={{ fontSize: '12px', color: gray500, marginBottom: '12px' }}>Select all that apply — patient will be sent to each selected department</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Pharmacy */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: theme.radius.md, border: `2px solid ${destinations.pharmacy ? tealDeep : border}`, background: destinations.pharmacy ? tealMist : 'white', cursor: 'pointer' }}>
            <input type='checkbox' checked={destinations.pharmacy} onChange={e => setDestinations(p => ({ ...p, pharmacy: e.target.checked }))} style={{ width: '18px', height: '18px', accentColor: tealDeep }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><PillIcon size={18} color={tealDeep} /><div><div style={{ fontWeight: '700', fontSize: '14px', color: navy }}>Pharmacy</div><div style={{ fontSize: '12px', color: gray500 }}>Send prescription for dispensing</div></div></div>
          </label>
          {/* Lab */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: theme.radius.md, border: `2px solid ${destinations.lab ? warning : border}`, background: destinations.lab ? warningBg : 'white', cursor: 'pointer' }}>
            <input type='checkbox' checked={destinations.lab} onChange={e => setDestinations(p => ({ ...p, lab: e.target.checked }))} style={{ width: '18px', height: '18px', accentColor: warning }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Microscope size={18} color={warning} /><div><div style={{ fontWeight: '700', fontSize: '14px', color: navy }}>Laboratory</div><div style={{ fontSize: '12px', color: gray500 }}>Send blood tests and investigations</div></div></div>
          </label>
          {/* Imaging */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: theme.radius.md, border: `2px solid ${destinations.imaging ? info : border}`, background: destinations.imaging ? infoBg : 'white', cursor: 'pointer' }}>
            <input type='checkbox' checked={destinations.imaging} onChange={e => setDestinations(p => ({ ...p, imaging: e.target.checked }))} style={{ width: '18px', height: '18px', accentColor: info }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Scan size={18} color={info} /><div><div style={{ fontWeight: '700', fontSize: '14px', color: navy }}>Imaging / Radiology</div><div style={{ fontSize: '12px', color: gray500 }}>Send X-ray, USS, CT scan requests</div></div></div>
          </label>
        </div>

        {/* Lab test entry */}
        {destinations.lab && (
          <div style={{ marginTop: '16px', padding: '14px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '13px', marginBottom: '10px', color: navy }}><Microscope size={14} color={warning} /> Lab Tests to Order</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input value={labTestInput} onChange={e => setLabTestInput(e.target.value)} placeholder='Type test name and press Add'
                style={{ flex: 1, padding: '8px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy }}
                onKeyDown={e => { if (e.key === 'Enter' && labTestInput.trim()) { setLabTests(prev => [...prev, labTestInput.trim()]); setLabTestInput('') } }} />
              <button onClick={() => { if (labTestInput.trim()) { setLabTests(prev => [...prev, labTestInput.trim()]); setLabTestInput('') } }}
                style={{ padding: '8px 14px', borderRadius: theme.radius.sm, border: 'none', background: warning, color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>Add</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {['Malaria RDT', 'FBC', 'PCV', 'Blood Sugar', 'Widal', 'Urinalysis', 'LFT', 'KFT', 'HIV', 'HBsAg'].map(t => { const on = labTests.includes(t); return (
                <button key={t} onClick={() => !on && setLabTests(prev => [...prev, t])}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '4px 10px', borderRadius: theme.radius.sm, border: `1px solid ${on ? warning : border}`, background: on ? warningBg : 'white', color: on ? warning : gray600, fontWeight: '600', fontSize: '11px', cursor: 'pointer' }}>
                  {on ? <Check size={11} /> : <Plus size={11} />}{t}
                </button>
              )})}
            </div>
            {labTests.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {labTests.map((t, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: theme.radius.full, background: 'white', border: `1px solid ${warning}`, color: warning, fontSize: '12px', fontWeight: '600' }}>
                    {t}
                    <button onClick={() => setLabTests(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: warning, fontWeight: '900', fontSize: '14px', lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <Sel label='Priority' value={consult.labPriority} onChange={v => setConsult(p => ({ ...p, labPriority: v }))} options={['routine', 'urgent', 'stat']} style={{ marginTop: '10px' }} />
          </div>
        )}

        {/* Imaging entry */}
        {destinations.imaging && (
          <div style={{ marginTop: '16px', padding: '14px', borderRadius: theme.radius.md, background: infoBg, border: `1px solid ${info}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '13px', marginBottom: '10px', color: navy }}><Scan size={14} color={info} /> Imaging Requests</div>
            {imagingRequests.map((img, i) => (
              <div key={i} style={{ marginBottom: '12px', padding: '12px', borderRadius: theme.radius.sm, background: 'white', border: `1px solid ${border}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <Sel label='Scan Type' value={img.scan_type} onChange={v => setImagingRequests(prev => prev.map((x, j) => j === i ? { ...x, scan_type: v } : x))} options={['X-ray', 'Ultrasound (USS)', 'CT Scan', 'MRI', 'Echocardiogram', 'Mammogram', 'Other']} />
                  <Sel label='Body Part' value={img.body_part} onChange={v => setImagingRequests(prev => prev.map((x, j) => j === i ? { ...x, body_part: v } : x))} options={['Chest', 'Abdomen', 'Pelvis', 'Head', 'Spine', 'Upper Limb', 'Lower Limb', 'Neck', 'Heart', 'Other']} />
                </div>
                <Inp label='Clinical Information' value={img.clinical_info} onChange={v => setImagingRequests(prev => prev.map((x, j) => j === i ? { ...x, clinical_info: v } : x))} placeholder='Reason for scan...' />
                {imagingRequests.length > 1 && <button onClick={() => setImagingRequests(prev => prev.filter((_, j) => j !== i))} style={{ marginTop: '6px', background: 'none', border: 'none', color: danger, cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Remove</button>}
              </div>
            ))}
            <button onClick={() => setImagingRequests(prev => [...prev, { scan_type: '', body_part: '', clinical_info: '' }])}
              style={{ padding: '7px 14px', borderRadius: theme.radius.sm, border: `1px dashed ${info}`, background: 'white', color: info, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>+ Add Another Scan</button>
          </div>
        )}
      </Card>

      {/* Communication thread */}
      {messages.length > 0 && (
        <Card style={{ padding: '20px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '15px', fontWeight: '800', marginBottom: '14px', color: navy }}><MessageCircle size={16} color={tealDeep} /> Patient Communications</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
            {messages.map(m => { const isDoctor = m.sender_role === 'Doctor'; return (
              <div key={m.id} style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: isDoctor ? infoBg : tealMist, border: `1px solid ${isDoctor ? infoBg : tealMist}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: isDoctor ? info : tealDeep }}>{m.sender_name} — {m.sender_role} ({m.department})</span>
                  <span style={{ fontSize: '10px', color: gray400 }}>{m.created_at?.replace('T', ' ').slice(0, 16)}</span>
                </div>
                <div style={{ fontSize: '13px', color: navy }}>{m.message}</div>
              </div>
            )})}
          </div>
        </Card>
      )}

      <button onClick={sendToPharmacy} disabled={saving}
        style={{ width: '100%', padding: '14px', borderRadius: theme.radius.md, border: 'none', background: saving ? theme.gray200 : tealDeep, color: saving ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving...' : 'Save & Send to Selected Departments →'}
      </button>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )

  if (done) return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><CheckCircle size={52} color={success} /></div>
      <div style={{ fontSize: '22px', fontWeight: '900', marginBottom: '8px', color: navy }}>Consultation Saved!</div>
      <div style={{ fontSize: '14px', color: gray500, marginBottom: '12px' }}>Patient: <strong>{selected.full_name}</strong></div>
      <div style={{ fontSize: '13px', color: gray600, marginBottom: '8px' }}>Doctor: <strong>{staffName}</strong></div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px' }}>
        {sentTo.includes('pharmacy') && <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: theme.radius.full, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '13px', color: tealDeep, fontWeight: '700' }}><PillIcon size={14} /> Prescription sent to Pharmacy</div>}
        {sentTo.includes('lab') && <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: theme.radius.full, background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: warning, fontWeight: '700' }}><Microscope size={14} /> Lab request sent</div>}
        {sentTo.includes('imaging') && <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: theme.radius.full, background: infoBg, border: `1px solid ${info}`, fontSize: '13px', color: info, fontWeight: '700' }}><Scan size={14} /> Imaging request sent</div>}
        {sentTo.length === 0 && <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: theme.radius.full, background: successBg, border: `1px solid ${success}`, fontSize: '13px', color: success, fontWeight: '700' }}><CheckCircle size={14} /> Patient discharged</div>}
      </div>
      <div><TealBtn onClick={() => { setSelected(null); setDone(false); setTriageData(null); setMessages([]); load() }}>Back to Patient List</TealBtn></div>
    </div>
  )

  return (
    <div>
      <SectionHead title='Doctor Consultation' sub='Patients waiting to see doctor' />
      <div style={{ position: 'relative', marginBottom: '16px' }}>
        <SearchIcon size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: gray400 }} />
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder='Search any patient across all departments — name, reg no, phone…'
          style={{ width: '100%', padding: '11px 12px 11px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', boxSizing: 'border-box', color: navy, fontFamily: theme.fontFamily }} />
      </div>
      {loading ? <Loading /> : patients.length === 0 ? (
        <Empty icon={<Stethoscope size={40} />} message={searchTerm.trim() ? 'No patients match your search' : 'No patients waiting for doctor'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {patients.map(p => (
            <Card key={p.id} style={{ padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <Avatar name={p.full_name} size={44} />
                <div>
                  <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{p.full_name}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{p.reg_no} · {p.phone}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{p.department || 'General OPD'}{p.assigned_doctor ? ' · ' + p.assigned_doctor : ''}</div>
                </div>
              </div>
              <TealBtn onClick={() => openPatient(p)}>Open File</TealBtn>
            </Card>
          ))}
        </div>
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
