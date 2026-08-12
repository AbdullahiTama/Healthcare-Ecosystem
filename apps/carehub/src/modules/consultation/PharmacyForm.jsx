import { useRef, useState, useEffect, useMemo } from 'react'
import { theme } from '../../styles/theme'
import { Card, Inp, Sel, Textarea, Toggle, TealBtn, GhostBtn, useToast } from '../../components/ui'
import SignaturePad from './SignaturePad'
import { Chips, Pills, YesNo, SectionCard, ProductSearchPicker } from './formParts'
import { getClients, addClient, addConsultation, addSale } from '../../services/supabase'
import { genId } from '../../lib/utils'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, bg, danger } = theme

const today = () => new Date().toISOString().split('T')[0]

const TYPE_OPTIONS = [
  ['new_symptom_otc', 'New Symptom / OTC Request'],
  ['medication_review', 'Medication Therapy Review'],
  ['chronic_disease', 'Chronic Disease Monitoring'],
  ['other', 'Other'],
]
export const PHARMACY_TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS)
const SEVERITY_OPTIONS = ['Mild', 'Moderate', 'Severe']
const RED_FLAG_OPTIONS = ['Fever >3 days', 'Difficulty breathing', 'Chest pain', 'Severe vomiting/diarrhea', 'Blood in stool/urine/vomit', 'Pregnant', 'Child under 2 years', 'None of the above']
const ADHERENCE_OPTIONS = ['Always', 'Sometimes Misses', 'Often Misses']
const ISSUE_OPTIONS = ['Side effects', 'Missed doses', 'Ran out early', 'Cost/affordability', 'Confused about instructions', 'None']
const MEDICAL_OPTIONS = ['Diabetes', 'High Blood Pressure', 'Asthma', 'Thyroid Disorder', 'Epilepsy', 'Kidney Disease', 'Liver Disease', 'Heart Disease', 'Peptic Ulcer', 'None', 'Other']
const RECOMMENDATION_TYPES = ['OTC Product Recommended', 'Prescription Dispensed', 'Non-Drug Advice Only', 'Referred to Doctor or Hospital']
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']

const isService = (p) => (p.cat || p.category) === 'Services'

export default function PharmacyForm({ brand, products = [], staffName = '', initialClient = null, onSaved, onCancel }) {
  const toast = useToast()
  const [client, setClient] = useState(initialClient)
  const [clientSearch, setClientSearch] = useState('')
  const [allClients, setAllClients] = useState([])
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quick, setQuick] = useState({ fullName: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)

  const consentPad = useRef(null)
  const pharmacistPad = useRef(null)

  const [form, setForm] = useState(() => ({
    date: today(),
    clientInfo: { dob: '', age: '', phone: '', email: '', address: '', occupation: '', weight: '', blood_group: '' },
    typeOfConsultation: { selected: [], other_text: '' },
    presenting: { symptom: '', duration: '', severity: '', associated: '', self_treatment: '', red_flags: [] },
    medReview: { rows: [], issues: [], interactions: '' },
    medical: { selected: [], other: '' },
    allergies: { none_on_file: false, drug_allergies: '', food_allergies: '', other_allergies: '' },
    female: { pregnant: '' },
    vitals: { bp: '', glucose: '', temp: '', pulse: '' },
    assessment: { problem: '', recommendation_type: '', products: [], counseling: '', referral_yesno: '', referral_reason: '', followup_yesno: '', followup_date: '' },
    consent: { agreed: false, date: today() },
    pharmacist: { name: staffName || '', license: '' },
  }))

  // Fee & dispensing: optional charge — default OFF per spec. When ON, the
  // sale = selected fee service product (if any) + the dispensed products.
  const [charge, setCharge] = useState({ enabled: false, feeProductId: '' })

  const set = (section, key, value) => setForm(p => ({ ...p, [section]: { ...p[section], [key]: value } }))
  const toggle = (section, key, option) => setForm(p => {
    const cur = p[section][key] || []
    return { ...p, [section]: { ...p[section], [key]: cur.includes(option) ? cur.filter(x => x !== option) : [...cur, option] } }
  })

  useEffect(() => {
    getClients(brand.id).then(c => setAllClients(c || [])).catch(() => {})
  }, [brand.id])

  const matched = useMemo(() => {
    const q = clientSearch.toLowerCase().trim()
    return q
      ? allClients.filter(c => c.full_name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      : []
  }, [allClients, clientSearch])

  const servicesProducts = useMemo(() => products.filter(isService), [products])
  const stockProducts = useMemo(() => products.filter(p => !isService(p)), [products])

  const setRow = (i, key, value) => setForm(p => {
    const rows = p.medReview.rows.map((r, idx) => idx === i ? { ...r, [key]: value } : r)
    return { ...p, medReview: { ...p.medReview, rows } }
  })
  const addRow = () => setForm(p => ({
    ...p,
    medReview: { ...p.medReview, rows: [...p.medReview.rows, { id: Date.now() + Math.random(), drug: '', dose: '', frequency: '', prescriber: '', indication: '', start_date: '', adherence: '' }] },
  }))
  const removeRow = (i) => setForm(p => ({
    ...p,
    medReview: { ...p.medReview, rows: p.medReview.rows.filter((_, idx) => idx !== i) },
  }))

  const toggleProduct = (prod) => setForm(p => {
    const cur = p.assessment.products
    const exists = cur.find(x => x.id === prod.id)
    const products = exists
      ? cur.filter(x => x.id !== prod.id)
      : [...cur, { id: prod.id, name: prod.name, price: prod.price || 0, qty: 1 }]
    return { ...p, assessment: { ...p.assessment, products } }
  })
  const setProductQty = (id, qty) => setForm(p => ({
    ...p,
    assessment: { ...p.assessment, products: p.assessment.products.map(x => x.id === id ? { ...x, qty: Math.max(1, parseInt(qty) || 1) } : x) },
  }))

  async function saveQuickAdd() {
    if (!quick.fullName.trim() || !quick.phone.trim()) { toast.show('Name and phone are required for a new client.', { type: 'warning' }); return }
    try {
      const created = (await addClient({
        business_id: brand.id,
        full_name: quick.fullName.trim(),
        phone: quick.phone.trim(),
        email: quick.email || '',
        total_spend: 0,
        visit_count: 0,
      }))[0] || null
      setClient(created)
      setShowQuickAdd(false)
      setQuick({ fullName: '', phone: '', email: '' })
      setAllClients(prev => [...prev, created])
      toast.show('Client added!', { type: 'success' })
    } catch (e) { toast.show('Could not add client. Please try again.', { type: 'error' }) }
  }

  async function save() {
    if (!client) { toast.show('Pick or create the client first.', { type: 'warning' }); return }
    if (!form.typeOfConsultation.selected.length) { toast.show('Select a type of consultation first.', { type: 'warning' }); return }
    const consentSig = consentPad.current?.getDataUrl() || ''
    const pharmacistSig = pharmacistPad.current?.getDataUrl() || ''

    const chargeItems = []
    const feeProduct = charge.enabled && charge.feeProductId ? servicesProducts.find(p => p.id === charge.feeProductId) : null
    if (feeProduct) chargeItems.push({ id: feeProduct.id, name: feeProduct.name, price: feeProduct.price || 0, qty: 1, cat: 'Services', source: 'dispensed' })
    form.assessment.products.forEach(x => chargeItems.push({ id: x.id, name: x.name, price: x.price, qty: x.qty, source: 'dispensed' }))
    if (charge.enabled && chargeItems.length === 0) { toast.show('Turn the charge on only if you are charging — add a fee product or dispensed products.', { type: 'warning' }); return }

    setSaving(true)
    try {
      // Dispensed items become a real sale (same addSale path as POS) so
      // stock behaves identically; the consultation links back via sale_id.
      let saleId = null
      if (chargeItems.length) {
        const subtotal = chargeItems.reduce((s, i) => s + (i.price || 0) * i.qty, 0)
        const sale = (await addSale({
          txn_no: genId('TXN'),
          client_id: client.id,
          client_name: client.full_name,
          items: JSON.stringify(chargeItems),
          subtotal,
          discount: 0,
          total: subtotal,
          payment_method: 'Cash',
          amount_paid: subtotal,
          balance: 0,
          is_credit: false,
          is_on_hold: false,
          business_id: brand.id,
        }))[0] || null
        saleId = sale?.id || null
      }

      const source = chargeItems.length ? 'dispensed' : 'recommended'
      const saved = await addConsultation({
        business_id: brand.id,
        client_id: client.id,
        client_name: client.full_name,
        consultation_date: form.date,
        consultation_type: 'pharmacy',
        provider_name: form.pharmacist.name,
        recommended_products: form.assessment.products.map(p => ({ ...p, source })),
        sale_id: saleId,
        data: {
          client_info: { full_name: client.full_name, ...form.clientInfo },
          type_of_consultation: form.typeOfConsultation,
          presenting_complaint: form.presenting,
          med_review: form.medReview,
          medical_history: form.medical,
          allergies: form.allergies,
          female: form.female,
          vitals: form.vitals,
          assessment: { ...form.assessment, products: form.assessment.products.map(p => ({ ...p, source })) },
          consent: { ...form.consent, signature: consentSig },
          pharmacist: { ...form.pharmacist, signature: pharmacistSig },
          charge: {
            enabled: charge.enabled,
            fee_product_id: feeProduct?.id || null,
            fee_product_name: feeProduct?.name || '',
            fee_amount: feeProduct?.price || 0,
            sale_total: chargeItems.reduce((s, i) => s + (i.price || 0) * i.qty, 0),
          },
        },
      })
      toast.show(chargeItems.length ? 'Consultation saved — products logged as a sale!' : 'Consultation saved!', { type: 'success' })
      onSaved?.(saved)
    } catch (e) {
      console.error('Pharmacy consultation save error:', e)
      toast.show('Could not save consultation. Please try again.', { type: 'error' })
    }
    setSaving(false)
  }

  const selectedTypeKeys = form.typeOfConsultation.selected
  const showOtc = selectedTypeKeys.includes('new_symptom_otc')
  const showMtr = selectedTypeKeys.includes('medication_review')

  return (
    <div>
      {/* 1. Type of consultation — opens the form */}
      <SectionCard title='Type of Consultation' hint='Select one or more — sections show/hide based on this.'>
        <Chips options={TYPE_OPTIONS.map(([k]) => k)} selected={selectedTypeKeys} onToggle={o => toggle('typeOfConsultation', 'selected', o)}
          customLabel={k => PHARMACY_TYPE_LABEL[k]} />
        {selectedTypeKeys.includes('other') && (
          <Inp label='Other — specify' value={form.typeOfConsultation.other_text} onChange={v => set('typeOfConsultation', 'other_text', v)} placeholder='Describe...' />
        )}
      </SectionCard>

      {/* 2. Client */}
      {!client ? (
        <SectionCard title='Client' hint="The consultation is saved inside the client's file — search for an existing client or add a new one.">
          <Inp label='Search clients' value={clientSearch} onChange={setClientSearch} placeholder='Search by name or phone...' />
          {matched.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {matched.map(c => (
                <button key={c.id} type="button" onClick={() => setClient(c)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderRadius: 10, border: `1px solid ${border}`, background: bg, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: navy }}>{c.full_name}</span>
                  <span style={{ fontSize: 12, color: gray400 }}>{c.phone || 'No phone'}</span>
                </button>
              ))}
            </div>
          )}
          {clientSearch && matched.length === 0 && (
            <button type="button" onClick={() => setShowQuickAdd(v => !v)} style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 10, border: 'none', background: tealMist, color: tealDeep, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              + Add "{clientSearch}" as a new client
            </button>
          )}
          {showQuickAdd && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 12, border: `1px solid ${border}`, background: bg }}>
              <Inp label='Full Name *' value={quick.fullName} onChange={v => setQuick(p => ({ ...p, fullName: v }))} placeholder={clientSearch || 'Client full name'} />
              <Inp label='Phone *' value={quick.phone} onChange={v => setQuick(p => ({ ...p, phone: v }))} placeholder='08012345678' />
              <Inp label='Email' value={quick.email} onChange={v => setQuick(p => ({ ...p, email: v }))} placeholder='client@email.com' />
              <TealBtn onClick={saveQuickAdd} style={{ alignSelf: 'flex-start', padding: '9px 18px' }}>Add Client</TealBtn>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard title='Client'>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: navy }}>{client.full_name}</div>
              <div style={{ fontSize: 12, color: gray400 }}>{client.phone}{client.email ? ' · ' + client.email : ''}</div>
            </div>
            <GhostBtn onClick={() => setClient(null)} style={{ padding: '7px 12px', fontSize: 12 }}>Change</GhostBtn>
          </div>
        </SectionCard>
      )}

      {client && (
        <>
          {/* 3A. Client Information */}
          <SectionCard title='Client Information'>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label='Date of Birth' type='date' value={form.clientInfo.dob} onChange={v => set('clientInfo', 'dob', v)} />
              <Inp label='Age' type='number' value={form.clientInfo.age} onChange={v => set('clientInfo', 'age', v)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label='Phone' value={form.clientInfo.phone} onChange={v => set('clientInfo', 'phone', v)} placeholder='08012345678' />
              <Inp label='Email' value={form.clientInfo.email} onChange={v => set('clientInfo', 'email', v)} placeholder='client@email.com' />
            </div>
            <Inp label='Address' value={form.clientInfo.address} onChange={v => set('clientInfo', 'address', v)} placeholder='Home address' />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label='Occupation' value={form.clientInfo.occupation} onChange={v => set('clientInfo', 'occupation', v)} placeholder='What they do' />
              <Inp label='Weight (kg)' value={form.clientInfo.weight} onChange={v => set('clientInfo', 'weight', v)} placeholder='e.g. 62' />
            </div>
            <Sel label='Known Blood Group' value={form.clientInfo.blood_group} onChange={v => set('clientInfo', 'blood_group', v)} options={BLOOD_GROUPS} />
          </SectionCard>

          {/* 3B. Presenting complaint (OTC) */}
          {showOtc && (
            <SectionCard title='Presenting Complaint' hint='For OTC / minor ailment consultations'>
              <Textarea label='Symptom(s) described by client' value={form.presenting.symptom} onChange={v => set('presenting', 'symptom', v)} rows={3} placeholder='e.g. headache and mild fever for 2 days...' />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Inp label='Duration of symptom' value={form.presenting.duration} onChange={v => set('presenting', 'duration', v)} placeholder='e.g. 3 days' />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Severity</div>
                  <Pills options={SEVERITY_OPTIONS} value={form.presenting.severity} onChange={v => set('presenting', 'severity', v)} />
                </div>
              </div>
              <Inp label='Associated symptoms' value={form.presenting.associated} onChange={v => set('presenting', 'associated', v)} placeholder='Any other symptoms' />
              <Inp label='Self-treatment already tried' value={form.presenting.self_treatment} onChange={v => set('presenting', 'self_treatment', v)} placeholder='e.g. paracetamol 1g twice daily' />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Red-flag check</div>
                <Chips options={RED_FLAG_OPTIONS} selected={form.presenting.red_flags} onToggle={o => toggle('presenting', 'red_flags', o)} />
              </div>
            </SectionCard>
          )}

          {/* 3C. Medication Therapy Review */}
          {showMtr && (
            <SectionCard title='Medication Therapy Review' hint='Current medications — repeatable rows. Fill one row per medicine.'>
              {form.medReview.rows.map((r, i) => (
                <div key={r.id} style={{ padding: 14, borderRadius: 12, border: `1px solid ${border}`, background: bg }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, fontSize: 12, color: navy }}>Medication {i + 1}</div>
                    <button type="button" onClick={() => removeRow(i)} style={{ border: 'none', background: 'none', color: danger, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Remove</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Inp label='Drug Name *' value={r.drug} onChange={v => setRow(i, 'drug', v)} placeholder='e.g. Metformin 500mg' />
                    <Inp label='Dose' value={r.dose} onChange={v => setRow(i, 'dose', v)} placeholder='e.g. 1 tab BD' />
                    <Inp label='Frequency' value={r.frequency} onChange={v => setRow(i, 'frequency', v)} placeholder='e.g. Twice daily' />
                    <Inp label='Prescriber (if any)' value={r.prescriber} onChange={v => setRow(i, 'prescriber', v)} placeholder='e.g. Dr. Sani' />
                    <Inp label='Indication' value={r.indication} onChange={v => setRow(i, 'indication', v)} placeholder='e.g. Type 2 diabetes' />
                    <Inp label='Start Date' type='date' value={r.start_date} onChange={v => setRow(i, 'start_date', v)} />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Adherence</div>
                    <Pills options={ADHERENCE_OPTIONS} value={r.adherence} onChange={v => setRow(i, 'adherence', v)} />
                  </div>
                </div>
              ))}
              <TealBtn onClick={addRow} style={{ alignSelf: 'flex-start', padding: '9px 16px', fontSize: 12.5 }}>+ Add medication</TealBtn>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Issues reported</div>
                <Chips options={ISSUE_OPTIONS} selected={form.medReview.issues} onToggle={o => toggle('medReview', 'issues', o)} />
              </div>
              <Textarea label='Drug interaction / duplication check' value={form.medReview.interactions} onChange={v => set('medReview', 'interactions', v)} rows={2} placeholder='Pharmacist notes — interactions, duplications, dose adjustments...' />
            </SectionCard>
          )}

          {/* 3D. Medical History */}
          <SectionCard title='Medical History' hint='Select all that apply'>
            <Chips options={MEDICAL_OPTIONS} selected={form.medical.selected} onToggle={o => toggle('medical', 'selected', o)} />
            {form.medical.selected.includes('Other') && (
              <Inp label='Other condition' value={form.medical.other} onChange={v => set('medical', 'other', v)} placeholder='Describe...' />
            )}
          </SectionCard>

          {/* 3E. Allergies */}
          <SectionCard title='Allergies'>
            <Toggle label='None on file' value={form.allergies.none_on_file} onChange={v => set('allergies', 'none_on_file', v)} />
            {!form.allergies.none_on_file && (
              <>
                <Inp label='Drug allergies' value={form.allergies.drug_allergies} onChange={v => set('allergies', 'drug_allergies', v)} placeholder='Drug + reaction, e.g. penicillin — rash' />
                <Inp label='Food allergies' value={form.allergies.food_allergies} onChange={v => set('allergies', 'food_allergies', v)} placeholder='e.g. peanuts' />
                <Inp label='Other allergies' value={form.allergies.other_allergies} onChange={v => set('allergies', 'other_allergies', v)} placeholder='e.g. latex' />
              </>
            )}
          </SectionCard>

          {/* 3F. For Female Clients */}
          <SectionCard title='For Female Clients' hint='Skip if not applicable'>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Pregnant / breastfeeding?</div>
              <YesNo value={form.female.pregnant} onChange={v => set('female', 'pregnant', v)} />
            </div>
          </SectionCard>

          {/* 3G. Vitals (optional) */}
          <SectionCard title='Vitals' hint='Optional — only if checked at the counter'>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label='Blood Pressure' value={form.vitals.bp} onChange={v => set('vitals', 'bp', v)} placeholder='e.g. 120/80' />
              <Inp label='Blood Glucose (RBS/FBS)' value={form.vitals.glucose} onChange={v => set('vitals', 'glucose', v)} placeholder='e.g. RBS 110' />
              <Inp label='Temperature' value={form.vitals.temp} onChange={v => set('vitals', 'temp', v)} placeholder='e.g. 36.9 °C' />
              <Inp label='Pulse' value={form.vitals.pulse} onChange={v => set('vitals', 'pulse', v)} placeholder='e.g. 76 bpm' />
            </div>
          </SectionCard>

          {/* 3H. Assessment & Outcome */}
          <SectionCard title='Pharmacist Assessment & Outcome'>
            <Textarea label="Pharmacist's assessment / problem identified" value={form.assessment.problem} onChange={v => set('assessment', 'problem', v)} rows={3} placeholder='e.g. mild viral URTI — suitable for OTC symptomatic relief' />
            <Sel label='Recommendation type' value={form.assessment.recommendation_type} onChange={v => set('assessment', 'recommendation_type', v)} options={RECOMMENDATION_TYPES} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Product(s) recommended or dispensed</div>
              {stockProducts.length === 0 ? (
                <div style={{ fontSize: 12, color: gray400 }}>No products in your catalog yet — add them in Inventory.</div>
              ) : (
                <ProductSearchPicker businessId={brand.id} selectedIds={form.assessment.products.map(p => p.id)} onToggle={toggleProduct} placeholder='Search products to dispense or recommend...' />
              )}
            </div>
            {form.assessment.products.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {form.assessment.products.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: `1px solid ${border}`, background: bg }}>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 12.5, color: navy }}>{p.name}</span>
                    <span style={{ fontSize: 11, color: gray400 }}>₦{Number(p.price || 0).toLocaleString()}</span>
                    <Inp label='' type='number' value={p.qty} onChange={v => setProductQty(p.id, v)} style={{ width: 64 }} aria-label={'Quantity of ' + p.name} />
                    <button type="button" onClick={() => toggleProduct(p)} aria-label={'Remove ' + p.name} style={{ border: 'none', background: 'none', color: danger, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <Textarea label='Counseling points given' value={form.assessment.counseling} onChange={v => set('assessment', 'counseling', v)} rows={2} placeholder='How to take it, what to avoid, warning signs to watch...' />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Referral out?</div>
              <YesNo value={form.assessment.referral_yesno} onChange={v => set('assessment', 'referral_yesno', v)} />
              {form.assessment.referral_yesno === 'yes' && (
                <div style={{ marginTop: 10 }}><Inp label='Reason for referral' value={form.assessment.referral_reason} onChange={v => set('assessment', 'referral_reason', v)} placeholder='e.g. red flags — fever >3 days' /></div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Follow-up needed?</div>
              <YesNo value={form.assessment.followup_yesno} onChange={v => set('assessment', 'followup_yesno', v)} />
              {form.assessment.followup_yesno === 'yes' && (
                <div style={{ marginTop: 10 }}><Inp label='Follow-up date' type='date' value={form.assessment.followup_date} onChange={v => set('assessment', 'followup_date', v)} /></div>
              )}
            </div>
          </SectionCard>

          {/* Charges & Dispensing */}
          <SectionCard title='Charges & Dispensing' hint='Payment is optional — only enable this when the pharmacy charges for the consultation.'>
            <Toggle label='Charge for this consultation' value={charge.enabled} onChange={v => setCharge(p => ({ ...p, enabled: v }))} />
            {charge.enabled && (
              <Sel label='Consultation fee product (Services)' value={charge.feeProductId} onChange={v => setCharge(p => ({ ...p, feeProductId: v }))}
                options={servicesProducts.map(p => ({ value: p.id, label: p.name + ' — ₦' + Number(p.price || 0).toLocaleString() }))} />
            )}
            {charge.enabled && servicesProducts.length === 0 && (
              <div style={{ fontSize: 12, color: gray500 }}>No Services products yet — create one named e.g. "Consultation Fee" in Inventory to charge a fee. Dispensed products below can still be charged without one.</div>
            )}
            {charge.enabled && (
              <div style={{ fontSize: 12, color: gray400, lineHeight: 1.6 }}>
                On save, this logs a sale with the fee product{form.assessment.products.length ? ' and the ' + form.assessment.products.length + ' dispensed product(s) selected above' : ''}. The consultation record links back to that sale.
              </div>
            )}
          </SectionCard>

          {/* Consent */}
          <SectionCard title='Consent'>
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6, padding: 12, borderRadius: 10, background: bg }}>
              I consent to this pharmacy consultation and counseling and confirm that the information I have provided is accurate to the best of my knowledge.
            </div>
            <Toggle label='I agree to the above statement' value={form.consent.agreed} onChange={v => set('consent', 'agreed', v)} />
            {form.consent.agreed && <SignaturePad ref={consentPad} label='Client signature — sign with finger or mouse' height={130} />}
            <Inp label='Consent date' type='date' value={form.consent.date} onChange={v => set('consent', 'date', v)} />
          </SectionCard>

          {/* Pharmacist details */}
          <SectionCard title='Pharmacist Details' hint='Staff section — filled by the pharmacist conducting the consultation'>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label='Pharmacist name' value={form.pharmacist.name} onChange={v => set('pharmacist', 'name', v)} placeholder='Your name' />
              <Inp label='PCN License Number' value={form.pharmacist.license} onChange={v => set('pharmacist', 'license', v)} placeholder='e.g. PCN/1234' />
            </div>
            <SignaturePad ref={pharmacistPad} label='Pharmacist signature' height={130} />
          </SectionCard>

          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <TealBtn onClick={save} disabled={saving} style={{ flex: 1, padding: '13px' }}>{saving ? 'Saving...' : 'Save Consultation'}</TealBtn>
            <GhostBtn onClick={onCancel} style={{ padding: '13px 20px' }}>Cancel</GhostBtn>
          </div>
        </>
      )}
    </div>
  )
}
