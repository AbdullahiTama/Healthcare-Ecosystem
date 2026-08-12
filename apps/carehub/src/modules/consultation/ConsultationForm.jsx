import { useRef, useState, useEffect, useMemo } from 'react'
import { theme } from '../../styles/theme'
import { Card, Inp, Textarea, Toggle, TealBtn, GhostBtn, useToast } from '../../components/ui'
import SignaturePad from './SignaturePad'
import { Chips, Pills, YesNo, SectionCard, ProductSearchPicker } from './formParts'
import { getClients, addClient, addConsultation } from '../../services/supabase'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, bg } = theme

const CONCERN_OPTIONS = ['Acne/Breakouts', 'Dark Spots/Hyperpigmentation', 'Uneven Skin Tone', 'Fine Lines/Wrinkles', 'Dull Skin', 'Dry Skin', 'Oily Skin', 'Sensitive Skin', 'Enlarged Pores', 'Blackheads/Whiteheads', 'Rosacea', 'Skin Tags', 'Sun Damage', 'Scarring', 'Other']
const SKIN_TYPE_OPTIONS = ['Dry', 'Oily', 'Combination', 'Normal', 'Sensitive']
const SYMPTOM_OPTIONS = ['Breakouts', 'Itching', 'Redness', 'Burning', 'Peeling', 'None']
const TREATMENT_OPTIONS = ['Chemical Peel', 'Microneedling', 'Dermaplaning', 'Microdermabrasion', 'Laser', 'Acne Extraction', 'Other']
const MEDICAL_OPTIONS = ['Diabetes', 'High BP', 'Asthma', 'Thyroid Disorder', 'Epilepsy', 'Autoimmune Disorder', 'Eczema', 'Psoriasis', 'Active Cold Sores', 'Keloid Scarring', 'None', 'Other']
const ALLERGY_OPTIONS = ['Skincare Products', 'Fragrances', 'Latex', 'Aspirin', 'Nuts', 'Medications', 'Foods']
const FITZPATRICK = ['I', 'II', 'III', 'IV', 'V', 'VI']

const today = () => new Date().toISOString().split('T')[0]

export default function ConsultationForm({ brand, products = [], staffName = '', initialClient = null, onSaved, onCancel }) {
  const toast = useToast()
  const [client, setClient] = useState(initialClient)
  const [clientSearch, setClientSearch] = useState('')
  const [allClients, setAllClients] = useState([])
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quick, setQuick] = useState({ fullName: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)

  const consentPad = useRef(null)
  const therapistPad = useRef(null)

  const [form, setForm] = useState(() => ({
    date: today(),
    clientInfo: { dob: '', age: '', phone: '', email: '', address: '', occupation: '' },
    emergency: { name: '', relationship: '', phone: '' },
    concerns: { selected: [], other: '' },
    skinHistory: { skin_type: '', symptoms: [], had_facial: '', facial_date: '', past_treatments: [], other_treatment: '' },
    routine: { cleanser: '', toner: '', serum: '', moisturizer: '', sunscreen: '', exfoliant: '', other: '' },
    medical: { selected: [], other: '' },
    allergies: { selected: [], specify: '' },
    lifestyle: { water: '', sleep: '', stress: '', smoker: '', sunscreen_frequency: '' },
    female: { pregnant: '', contraceptives: '' },
    consent: { agreed: false, date: today() },
    assessment: { skin_type: '', skin_condition: '', fitzpatrick: '', treatment_recommended: '', products_recommended: [], homecare_plan: '', facial_care_recommendations: '', instructions: '', therapist_name: staffName || '', therapist_signature: '' },
  }))

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

  const recProductIds = form.assessment.products_recommended

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
    const consentSig = consentPad.current?.getDataUrl() || ''
    const therapistSig = therapistPad.current?.getDataUrl() || ''
    setSaving(true)
    try {
      const saved = await addConsultation({
        business_id: brand.id,
        client_id: client.id,
        client_name: client.full_name,
        consultation_date: form.date,
        consultation_type: 'skincare',
        provider_name: form.assessment.therapist_name,
        recommended_products: recProductIds.map(id => { const p = products.find(x => x.id === id); return p ? { id: p.id, name: p.name } : null }).filter(Boolean),
        data: {
          client_info: { full_name: client.full_name, ...form.clientInfo },
          emergency_contact: form.emergency,
          skin_concerns: form.concerns,
          skin_history: form.skinHistory,
          routine: form.routine,
          medical_history: form.medical,
          allergies: form.allergies,
          lifestyle: form.lifestyle,
          female: form.female,
          consent: { ...form.consent, signature: consentSig },
          assessment: { ...form.assessment, therapist_signature: therapistSig },
        },
      })
      toast.show('Consultation saved!', { type: 'success' })
      onSaved?.(saved)
    } catch (e) {
      console.error('Consultation save error:', e)
      toast.show('Could not save consultation. Please try again.', { type: 'error' })
    }
    setSaving(false)
  }

  return (
    <div>
      {/* Client step */}
      {!client ? (
        <SectionCard title="Client" hint="The consultation is saved inside the client's file — search for an existing client or add a new one.">
          <Inp label="Search clients" value={clientSearch} onChange={setClientSearch} placeholder="Search by name or phone..." />
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
              <Inp label="Full Name *" value={quick.fullName} onChange={v => setQuick(p => ({ ...p, fullName: v }))} placeholder={clientSearch || 'Client full name'} />
              <Inp label="Phone *" value={quick.phone} onChange={v => setQuick(p => ({ ...p, phone: v }))} placeholder="08012345678" />
              <Inp label="Email" value={quick.email} onChange={v => setQuick(p => ({ ...p, email: v }))} placeholder="client@email.com" />
              <TealBtn onClick={saveQuickAdd} style={{ alignSelf: 'flex-start', padding: '9px 18px' }}>Add Client</TealBtn>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Client">
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
          {/* 1. Client Information */}
          <SectionCard title="Client Information">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label="Date of Birth" type="date" value={form.clientInfo.dob} onChange={v => set('clientInfo', 'dob', v)} />
              <Inp label="Age" type="number" value={form.clientInfo.age} onChange={v => set('clientInfo', 'age', v)} />
            </div>
            <Inp label="Phone" value={form.clientInfo.phone} onChange={v => set('clientInfo', 'phone', v)} placeholder="08012345678" />
            <Inp label="Email" value={form.clientInfo.email} onChange={v => set('clientInfo', 'email', v)} placeholder="client@email.com" />
            <Inp label="Address" value={form.clientInfo.address} onChange={v => set('clientInfo', 'address', v)} placeholder="Home address" />
            <Inp label="Occupation" value={form.clientInfo.occupation} onChange={v => set('clientInfo', 'occupation', v)} placeholder="What they do" />
          </SectionCard>

          {/* 2. Emergency Contact */}
          <SectionCard title="Emergency Contact">
            <Inp label="Name" value={form.emergency.name} onChange={v => set('emergency', 'name', v)} placeholder="Emergency contact name" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label="Relationship" value={form.emergency.relationship} onChange={v => set('emergency', 'relationship', v)} placeholder="e.g. Spouse" />
              <Inp label="Phone" value={form.emergency.phone} onChange={v => set('emergency', 'phone', v)} placeholder="08012345678" />
            </div>
          </SectionCard>

          {/* 3. Skin Concerns */}
          <SectionCard title="Skin Concerns" hint="Select all that apply">
            <Chips options={CONCERN_OPTIONS} selected={form.concerns.selected} onToggle={o => toggle('concerns', 'selected', o)} />
            {form.concerns.selected.includes('Other') && (
              <Inp label="Other concern" value={form.concerns.other} onChange={v => set('concerns', 'other', v)} placeholder="Describe..." />
            )}
          </SectionCard>

          {/* 4. Skin History */}
          <SectionCard title="Skin History">
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Skin type</div>
              <Pills options={SKIN_TYPE_OPTIONS} value={form.skinHistory.skin_type} onChange={v => set('skinHistory', 'skin_type', v)} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Current symptoms</div>
              <Chips options={SYMPTOM_OPTIONS} selected={form.skinHistory.symptoms} onToggle={o => toggle('skinHistory', 'symptoms', o)} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Had a facial before?</div>
              <YesNo value={form.skinHistory.had_facial} onChange={v => set('skinHistory', 'had_facial', v)} />
              {form.skinHistory.had_facial === 'yes' && (
                <div style={{ marginTop: 10 }}><Inp label="Last facial date" type="date" value={form.skinHistory.facial_date} onChange={v => set('skinHistory', 'facial_date', v)} /></div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Past treatments</div>
              <Chips options={TREATMENT_OPTIONS} selected={form.skinHistory.past_treatments} onToggle={o => toggle('skinHistory', 'past_treatments', o)} />
            </div>
            {form.skinHistory.past_treatments.includes('Other') && (
              <Inp label="Other treatment" value={form.skinHistory.other_treatment} onChange={v => set('skinHistory', 'other_treatment', v)} placeholder="Describe..." />
            )}
          </SectionCard>

          {/* 5. Current Skincare Routine */}
          <SectionCard title="Current Skincare Routine">
            {[['cleanser', 'Cleanser'], ['toner', 'Toner'], ['serum', 'Serum'], ['moisturizer', 'Moisturizer'], ['sunscreen', 'Sunscreen'], ['exfoliant', 'Exfoliant'], ['other', 'Other Products']].map(([k, label]) => (
              <Inp key={k} label={label} value={form.routine[k]} onChange={v => set('routine', k, v)} placeholder={k === 'other' ? 'Anything else they use' : 'Products they currently use'} />
            ))}
          </SectionCard>

          {/* 6. Medical History */}
          <SectionCard title="Medical History" hint="Select all that apply">
            <Chips options={MEDICAL_OPTIONS} selected={form.medical.selected} onToggle={o => toggle('medical', 'selected', o)} />
            {form.medical.selected.includes('Other') && (
              <Inp label="Other condition" value={form.medical.other} onChange={v => set('medical', 'other', v)} placeholder="Describe..." />
            )}
          </SectionCard>

          {/* 7. Allergies */}
          <SectionCard title="Allergies" hint="Select all that apply">
            <Chips options={ALLERGY_OPTIONS} selected={form.allergies.selected} onToggle={o => toggle('allergies', 'selected', o)} />
            <Inp label="Specify" value={form.allergies.specify} onChange={v => set('allergies', 'specify', v)} placeholder="Details of any allergies..." />
          </SectionCard>

          {/* 8. Lifestyle */}
          <SectionCard title="Lifestyle">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label="Water intake" value={form.lifestyle.water} onChange={v => set('lifestyle', 'water', v)} placeholder="e.g. 3 glasses a day" />
              <Inp label="Sleep" value={form.lifestyle.sleep} onChange={v => set('lifestyle', 'sleep', v)} placeholder="e.g. 6 hours / night" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Inp label="Stress level" value={form.lifestyle.stress} onChange={v => set('lifestyle', 'stress', v)} placeholder="e.g. Moderate" />
              <Inp label="Sunscreen use" value={form.lifestyle.sunscreen_frequency} onChange={v => set('lifestyle', 'sunscreen_frequency', v)} placeholder="e.g. Daily / Rarely" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Smoker?</div>
              <YesNo value={form.lifestyle.smoker} onChange={v => set('lifestyle', 'smoker', v)} />
            </div>
          </SectionCard>

          {/* 9. For Female Clients */}
          <SectionCard title="For Female Clients" hint="Skip if not applicable">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Pregnant / breastfeeding?</div>
                <YesNo value={form.female.pregnant} onChange={v => set('female', 'pregnant', v)} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>On hormonal contraceptives?</div>
                <YesNo value={form.female.contraceptives} onChange={v => set('female', 'contraceptives', v)} />
              </div>
            </div>
          </SectionCard>

          {/* 10. Consent */}
          <SectionCard title="Consent">
            <div style={{ fontSize: 13, color: gray600, lineHeight: 1.6, padding: 12, borderRadius: 10, background: bg }}>
              I consent to the skin consultation and the treatment plan given to me. I confirm that the information I have provided is accurate to the best of my knowledge.
            </div>
            <Toggle label="I agree to the above statement" value={form.consent.agreed} onChange={v => set('consent', 'agreed', v)} />
            {form.consent.agreed && <SignaturePad ref={consentPad} label="Client signature — sign with finger or mouse" height={130} />}
            <Inp label="Consent date" type="date" value={form.consent.date} onChange={v => set('consent', 'date', v)} />
          </SectionCard>

          {/* 11. Therapist Assessment */}
          <SectionCard title="Therapist Assessment" hint="Staff section — filled by the aesthetician / skincare scientist">
            <Inp label="Therapist name" value={form.assessment.therapist_name} onChange={v => set('assessment', 'therapist_name', v)} placeholder="Your name" />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Assessed skin type</div>
              <Pills options={SKIN_TYPE_OPTIONS} value={form.assessment.skin_type} onChange={v => set('assessment', 'skin_type', v)} />
            </div>
            <Inp label="Skin condition" value={form.assessment.skin_condition} onChange={v => set('assessment', 'skin_condition', v)} placeholder="e.g. Mild acne with post-inflammatory hyperpigmentation" />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Fitzpatrick skin type</div>
              <Pills options={FITZPATRICK} value={form.assessment.fitzpatrick} onChange={v => set('assessment', 'fitzpatrick', v)} />
            </div>
            <Inp label="Treatment recommended" value={form.assessment.treatment_recommended} onChange={v => set('assessment', 'treatment_recommended', v)} placeholder="e.g. Chemical peel series + prescription products" />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gray600, marginBottom: 6 }}>Products recommended</div>
              {products.length === 0 ? (
                <div style={{ fontSize: 12, color: gray400 }}>No products in your catalog yet — add them in Inventory.</div>
              ) : (
                <ProductSearchPicker businessId={brand.id} selectedIds={recProductIds} onToggle={prod => toggle('assessment', 'products_recommended', prod.id)} placeholder='Search products to recommend...' />
              )}
              {recProductIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {recProductIds.map(id => {
                    const p = products.find(x => x.id === id)
                    if (!p) return null
                    return (
                      <button key={id} type="button" onClick={() => toggle('assessment', 'products_recommended', id)} aria-label={'Remove ' + p.name}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: theme.radius.full, border: `1px solid ${tealDeep}`, background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {p.name} <span style={{ fontSize: 13, lineHeight: 1 }}>×</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <Textarea label="Homecare plan" value={form.assessment.homecare_plan} onChange={v => set('assessment', 'homecare_plan', v)} rows={3} placeholder="What the client should do at home — morning / evening routine, SPF..." />
            <Textarea label="Facial / other care recommendations" value={form.assessment.facial_care_recommendations} onChange={v => set('assessment', 'facial_care_recommendations', v)} rows={3} placeholder="Specific facials or other care services recommended (e.g. hydrafacial, LED therapy)..." />
            <Textarea label="Instructions" value={form.assessment.instructions} onChange={v => set('assessment', 'instructions', v)} rows={3} placeholder="Aftercare instructions, precautions, when to return..." />
            <SignaturePad ref={therapistPad} label="Therapist signature" height={130} />
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
