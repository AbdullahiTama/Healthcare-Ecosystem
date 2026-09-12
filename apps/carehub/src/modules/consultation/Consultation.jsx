import { useState, useEffect, useMemo, Children } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clipboard, Search, UserPlus, Calendar, FileDown, Repeat, Stethoscope } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, TealBtn, GhostBtn, Avatar, Loading, Empty, useToast, Toast } from '../../components/ui'
import ConsultationForm from './ConsultationForm'
import PharmacyForm, { PHARMACY_TYPE_LABEL } from './PharmacyForm'
import { printConsultation, printPharmacyConsultation } from './consultationPrint'
import { getConsultations, getClients } from '../../services/supabase'

const { tealDeep, navy, gray600, gray500, gray400, border, bg } = theme

const parse = (r) => {
  try { return typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {}) } catch (e) { return {} }
}

function DRow({ label, value }) {
  if (value === '' || value === null || value === undefined) return null
  const v = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value)
  if (!v) return null
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: `1px solid ${theme.gray100}`, fontSize: 13 }}>
      <span style={{ width: 170, flexShrink: 0, color: gray500, fontWeight: 700 }}>{label}</span>
      <span style={{ color: navy }}>{v}</span>
    </div>
  )
}

function DSec({ title, children }) {
  const kids = Children.toArray(children).filter(Boolean)
  if (!kids.length) return null
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>
      {kids}
    </div>
  )
}

export default function Consultation({ brand, products, staffName }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formClient, setFormClient] = useState(null)
  const [clients, setClients] = useState([])
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

  const isPharmacy = (brand?.business_type || brand?.type) === 'pharmacy'

  async function load() {
    if (!brand?.id) return
    setLoading(true)
    try {
      const data = await getConsultations(brand.id, {
        query: search.trim() || undefined,
        type: typeFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      })
      setRows(data || [])
    } catch (e) {
      console.error('Consultation load error:', e)
      setRows([])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!brand?.id) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line
  }, [brand?.id, search, from, to, typeFilter])

  useEffect(() => {
    if (!brand?.id) return
    getClients(brand.id).then(c => setClients(c || [])).catch(() => {})
  }, [brand?.id])

  // Deep link from Clients.jsx ("New Consultation" in the client's file):
  // /consultation?client=<id> pre-selects that client and opens the form.
  useEffect(() => {
    const id = searchParams.get('client')
    if (!id) return
    const c = clients.find(x => x.id === id)
    setFormClient(c || null)
    setShowForm(true)
    setSearchParams({}, { replace: true })
  }, [clients, searchParams, setSearchParams])

  const stats = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7)
    const month = rows.filter(r => r.consultation_date?.startsWith(thisMonth)).length
    const unique = new Set(rows.map(r => r.client_id)).size
    return { total: rows.length, month, unique }
  }, [rows])

  function openNewVisit() {
    const client = formClient || (selected ? clients.find(c => c.id === selected.client_id) : null)
    setFormClient(client || null)
    setShowForm(true)
  }

  function onSaved(saved) {
    setShowForm(false)
    setFormClient(null)
    setSelected(saved)
    load()
  }

  const d = selected ? parse(selected) : {}
  const g = (k) => d[k] || {}

  const recProducts = selected?.recommended_products || []

  return (
    <div>
      <SectionHead title='Consultations' sub={isPharmacy ? 'Pharmacy consultations — OTC advice & medication reviews' : 'Skin & aesthetic consultation forms'} btn='+ New Consultation' onBtn={() => { setFormClient(null); setShowForm(true) }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Clipboard />} label='Total Consultations' value={stats.total} />
        <StatCard icon={<Calendar />} label='This Month' value={stats.month} />
        <StatCard icon={<UserPlus />} label='Unique Clients' value={stats.unique} />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search by client name...'
            style={{ flex: 1, padding: '12px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label='Filter by consultation type'
          style={{ padding: '10px', border: `1px solid ${border}`, borderRadius: theme.radius.md, fontSize: 12.5, color: navy, background: theme.cardBg, outline: 'none' }}>
          <option value=''>All types</option>
          <option value='skincare'>Skincare</option>
          <option value='pharmacy'>Pharmacy</option>
        </select>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" style={{ padding: '9px 10px', border: `1px solid ${border}`, borderRadius: theme.radius.md, fontSize: 12.5, color: navy, background: theme.cardBg, outline: 'none' }} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" style={{ padding: '9px 10px', border: `1px solid ${border}`, borderRadius: theme.radius.md, fontSize: 12.5, color: navy, background: theme.cardBg, outline: 'none' }} />
        </div>
      </div>

      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty icon={<Clipboard size={40} color={theme.gray300} strokeWidth={1.5} />}
          message={search || from || to || typeFilter ? 'No consultations match your filters' : isPharmacy ? 'No consultations yet. Start your first pharmacy consultation!' : 'No consultations yet. Start your first consultation!'}
          action='+ New Consultation' onAction={() => { setFormClient(null); setShowForm(true) }} cause={search || from || to || typeFilter ? 'filtered' : 'none'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {rows.map(r => {
            const rd = parse(r)
            const subTypes = (rd.type_of_consultation?.selected || []).map(k => PHARMACY_TYPE_LABEL[k]).filter(Boolean)
            const skinType = rd.assessment?.skin_type || ''
            return (
              <Card key={r.id} style={{ padding: '16px', cursor: 'pointer' }} onClick={() => setSelected(r)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                    <Avatar name={r.client_name} size={44} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{r.client_name}</div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>
                        {r.consultation_date || '—'}{r.provider_name ? ' · ' + r.provider_name : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                        <Pill label={r.consultation_type === 'pharmacy' ? 'Pharmacy' : 'Skincare'} type={r.consultation_type === 'pharmacy' ? 'blue' : 'green'} style={{ fontSize: 9.5, textTransform: 'uppercase' }} />
                        {r.consultation_type === 'pharmacy'
                          ? subTypes.map(s => <Pill key={s} label={s} type='teal' style={{ fontSize: 9.5 }} />)
                          : skinType && <Pill label={skinType} type='teal' style={{ fontSize: 9.5, textTransform: 'uppercase' }} />}
                        {(r.recommended_products || []).length > 0 && <Pill label={r.recommended_products.length + ' product' + (r.recommended_products.length > 1 ? 's' : '')} type='purple' style={{ fontSize: 9.5 }} />}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: gray400, fontWeight: 700 }}>
                      <FileDown size={13} /> Print
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* New consultation form — skincare or pharmacy by business type */}
      <Modal show={showForm} onClose={() => { setShowForm(false); setFormClient(null) }} title='New Consultation' wide
        footer={<GhostBtn onClick={() => { setShowForm(false); setFormClient(null) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>}>
        {isPharmacy ? (
          <PharmacyForm brand={brand} products={products} staffName={staffName} initialClient={formClient} onSaved={onSaved} onCancel={() => { setShowForm(false); setFormClient(null) }} />
        ) : (
          <ConsultationForm brand={brand} products={products} staffName={staffName} initialClient={formClient} onSaved={onSaved} onCancel={() => { setShowForm(false); setFormClient(null) }} />
        )}
      </Modal>

      {/* Consultation detail */}
      <Modal show={!!selected} onClose={() => setSelected(null)} title={selected ? 'Consultation — ' + selected.client_name : ''} wide
        footer={selected ? (
          <>
            <GhostBtn onClick={() => openNewVisit()} style={{ flex: 1, padding: '12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Repeat size={14} /> New visit</span></GhostBtn>
            <TealBtn onClick={() => (selected.consultation_type === 'pharmacy' ? printPharmacyConsultation(selected, brand) : printConsultation(selected, brand))} style={{ flex: 1, padding: '12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileDown size={14} /> Export PDF</span></TealBtn>
          </>
        ) : null}>
        {selected && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, padding: 14, borderRadius: theme.radius.lg, background: bg }}>
              <Avatar name={selected.client_name} size={46} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: navy }}>{selected.client_name}</div>
                <div style={{ fontSize: 12, color: gray500 }}>{selected.consultation_date}{selected.provider_name ? ' · ' + selected.provider_name : ''}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <Pill label={selected.consultation_type === 'pharmacy' ? 'Pharmacy' : 'Skincare'} type={selected.consultation_type === 'pharmacy' ? 'blue' : 'green'} />
              </div>
            </div>

            {selected.consultation_type === 'pharmacy' ? <PharmacyDetail d={d} g={g} recProducts={recProducts} /> : <SkincareDetail d={d} g={g} recProducts={recProducts} />}
          </div>
        )}
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

function SkincareDetail({ d, g, recProducts }) {
  const ci = g('client_info'), ec = g('emergency_contact'), sc = g('skin_concerns'),
    sh = g('skin_history'), rt = g('routine'), mh = g('medical_history'),
    al = g('allergies'), ls = g('lifestyle'), fe = g('female'),
    co = g('consent'), as = g('assessment')
  return (
    <>
      <DSec title='Client Information'>
        <DRow label='Full Name' value={ci.full_name} />
        <DRow label='Date of Birth' value={ci.dob} />
        <DRow label='Age' value={ci.age} />
        <DRow label='Phone' value={ci.phone} />
        <DRow label='Email' value={ci.email} />
        <DRow label='Address' value={ci.address} />
        <DRow label='Occupation' value={ci.occupation} />
      </DSec>

      <DSec title='Emergency Contact'>
        <DRow label='Name' value={ec.name} />
        <DRow label='Relationship' value={ec.relationship} />
        <DRow label='Phone' value={ec.phone} />
      </DSec>

      <DSec title='Skin Concerns'>
        <DRow label='Concerns' value={sc.selected} />
        <DRow label='Other' value={sc.other} />
      </DSec>

      <DSec title='Skin History'>
        <DRow label='Skin Type' value={sh.skin_type} />
        <DRow label='Current Symptoms' value={sh.symptoms} />
        <DRow label='Had a Facial Before?' value={sh.had_facial ? (sh.had_facial === 'yes' ? 'Yes' + (sh.facial_date ? ' (' + sh.facial_date + ')' : '') : 'No') : ''} />
        <DRow label='Past Treatments' value={sh.past_treatments} />
        <DRow label='Other' value={sh.other_treatment} />
      </DSec>

      <DSec title='Current Skincare Routine'>
        <DRow label='Cleanser' value={rt.cleanser} />
        <DRow label='Toner' value={rt.toner} />
        <DRow label='Serum' value={rt.serum} />
        <DRow label='Moisturizer' value={rt.moisturizer} />
        <DRow label='Sunscreen' value={rt.sunscreen} />
        <DRow label='Exfoliant' value={rt.exfoliant} />
        <DRow label='Other' value={rt.other} />
      </DSec>

      <DSec title='Medical History'>
        <DRow label='Conditions' value={mh.selected} />
        <DRow label='Other' value={mh.other} />
      </DSec>

      <DSec title='Allergies'>
        <DRow label='Allergies' value={al.selected} />
        <DRow label='Specify' value={al.specify} />
      </DSec>

      <DSec title='Lifestyle'>
        <DRow label='Water Intake' value={ls.water} />
        <DRow label='Sleep' value={ls.sleep} />
        <DRow label='Stress Level' value={ls.stress} />
        <DRow label='Smoker' value={ls.smoker === 'yes' ? 'Yes' : ls.smoker === 'no' ? 'No' : ''} />
        <DRow label='Sunscreen Use' value={ls.sunscreen_frequency} />
      </DSec>

      <DSec title='For Female Clients'>
        <DRow label='Pregnant / Breastfeeding' value={fe.pregnant === 'yes' ? 'Yes' : fe.pregnant === 'no' ? 'No' : ''} />
        <DRow label='Hormonal Contraceptives' value={fe.contraceptives === 'yes' ? 'Yes' : fe.contraceptives === 'no' ? 'No' : ''} />
      </DSec>

      <DSec title='Therapist Assessment'>
        <DRow label='Skin Type' value={as.skin_type} />
        <DRow label='Skin Condition' value={as.skin_condition} />
        <DRow label='Fitzpatrick' value={as.fitzpatrick} />
        <DRow label='Treatment Recommended' value={as.treatment_recommended} />
        <DRow label='Homecare Plan' value={as.homecare_plan} />
        <DRow label='Facial / Other Care Recommendations' value={as.facial_care_recommendations} />
        <DRow label='Instructions' value={as.instructions} />
      </DSec>

      <ProductSection recProducts={recProducts} />

      <DSec title='Consent'>
        <DRow label='Consent Given' value={co.agreed ? 'Yes' : ''} />
        <DRow label='Date' value={co.date} />
        {co.signature && <img src={co.signature} alt='Client signature' style={{ height: 64, borderBottom: `1px solid ${gray400}`, marginTop: 8 }} />}
      </DSec>

      {as.therapist_signature && (
        <DSec title='Therapist Signature'>
          <img src={as.therapist_signature} alt='Therapist signature' style={{ height: 64, borderBottom: `1px solid ${gray400}` }} />
        </DSec>
      )}
    </>
  )
}

function ProductSection({ recProducts }) {
  if (!recProducts.length) return null
  return (
    <DSec title='Products'>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0' }}>
        {recProducts.map((p, i) => (
          <Pill key={p.id || i} label={p.name + (p.source === 'dispensed' ? ' (dispensed)' : '')} type={p.source === 'dispensed' ? 'blue' : 'purple'} />
        ))}
      </div>
    </DSec>
  )
}

function PharmacyDetail({ d, g, recProducts }) {
  const ci = g('client_info'), ty = g('type_of_consultation'), pc = g('presenting_complaint'),
    mr = g('med_review'), mh = g('medical_history'), al = g('allergies'),
    fe = g('female'), vt = g('vitals'), as = g('assessment'),
    co = g('consent'), ph = g('pharmacist'), ch = g('charge')
  const medRows = Array.isArray(mr.rows) ? mr.rows : []
  const types = ty.selected || []
  return (
    <>
      <DSec title='Client Information'>
        <DRow label='Full Name' value={ci.full_name} />
        <DRow label='Date of Birth' value={ci.dob} />
        <DRow label='Age' value={ci.age} />
        <DRow label='Phone' value={ci.phone} />
        <DRow label='Email' value={ci.email} />
        <DRow label='Address' value={ci.address} />
        <DRow label='Occupation' value={ci.occupation} />
        <DRow label='Weight (kg)' value={ci.weight} />
        <DRow label='Blood Group' value={ci.blood_group} />
      </DSec>

      <DSec title='Type of Consultation'>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 0' }}>
          {types.map(k => <Pill key={k} label={PHARMACY_TYPE_LABEL[k] || k} type='teal' />)}
        </div>
        <DRow label='Other (specify)' value={ty.other_text} />
      </DSec>

      <DSec title='Presenting Complaint'>
        <DRow label='Symptom(s) described' value={pc.symptom} />
        <DRow label='Duration' value={pc.duration} />
        <DRow label='Severity' value={pc.severity} />
        <DRow label='Associated symptoms' value={pc.associated} />
        <DRow label='Self-treatment tried' value={pc.self_treatment} />
        <DRow label='Red-flag check' value={pc.red_flags} />
      </DSec>

      <DSec title='Medication Therapy Review'>
        {medRows.length === 0 ? <DRow label='Medications' value='' /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0' }}>
            {medRows.map((r, i) => (
              <div key={i} style={{ padding: 12, borderRadius: 10, border: `1px solid ${theme.gray100}`, background: bg, fontSize: 12.5 }}>
                <div style={{ fontWeight: 800, color: navy }}>{r.drug || '—'}{r.dose ? ' · ' + r.dose : ''}{r.frequency ? ' · ' + r.frequency : ''}</div>
                <div style={{ color: gray500, marginTop: 3 }}>
                  {[r.prescriber && 'Rx: ' + r.prescriber, r.indication, r.start_date && 'since ' + r.start_date, r.adherence].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
        <DRow label='Issues reported' value={mr.issues} />
        <DRow label='Interaction / duplication check' value={mr.interactions} />
      </DSec>

      <DSec title='Medical History'>
        <DRow label='Conditions' value={mh.selected} />
        <DRow label='Other' value={mh.other} />
      </DSec>

      <DSec title='Allergies'>
        <DRow label='None on file' value={al.none_on_file ? 'Yes' : ''} />
        <DRow label='Drug allergies' value={al.drug_allergies} />
        <DRow label='Food allergies' value={al.food_allergies} />
        <DRow label='Other allergies' value={al.other_allergies} />
      </DSec>

      <DSec title='For Female Clients'>
        <DRow label='Pregnant / Breastfeeding' value={fe.pregnant === 'yes' ? 'Yes' : fe.pregnant === 'no' ? 'No' : ''} />
      </DSec>

      <DSec title='Vitals'>
        <DRow label='Blood Pressure' value={vt.bp} />
        <DRow label='Blood Glucose' value={vt.glucose} />
        <DRow label='Temperature' value={vt.temp} />
        <DRow label='Pulse' value={vt.pulse} />
      </DSec>

      <DSec title='Assessment & Outcome'>
        <DRow label='Assessment / problem' value={as.problem} />
        <DRow label='Recommendation type' value={as.recommendation_type} />
        <DRow label='Counseling points' value={as.counseling} />
        <DRow label='Referral' value={as.referral_yesno === 'yes' ? 'Yes — ' + (as.referral_reason || '') : as.referral_yesno === 'no' ? 'No' : ''} />
        <DRow label='Follow-up' value={as.followup_yesno === 'yes' ? 'Yes — ' + (as.followup_date || '') : as.followup_yesno === 'no' ? 'No' : ''} />
      </DSec>

      <ProductSection recProducts={recProducts} />

      {ch.enabled && (
        <DSec title='Charges'>
          <DRow label='Consultation fee' value={ch.fee_product_name ? ch.fee_product_name + ' — ₦' + Number(ch.fee_amount || 0).toLocaleString() : ''} />
          <DRow label='Sale total' value={ch.sale_total ? '₦' + Number(ch.sale_total).toLocaleString() : ''} />
        </DSec>
      )}

      <DSec title='Consent'>
        <DRow label='Consent Given' value={co.agreed ? 'Yes' : ''} />
        <DRow label='Date' value={co.date} />
        {co.signature && <img src={co.signature} alt='Client signature' style={{ height: 64, borderBottom: `1px solid ${gray400}`, marginTop: 8 }} />}
      </DSec>

      <DSec title='Pharmacist'>
        <DRow label='Name' value={ph.name} />
        <DRow label='PCN License' value={ph.license} />
        {ph.signature && <img src={ph.signature} alt='Pharmacist signature' style={{ height: 64, borderBottom: `1px solid ${gray400}` }} />}
      </DSec>
    </>
  )
}
