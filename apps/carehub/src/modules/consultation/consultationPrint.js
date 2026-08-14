// Branded PDF exports for consultation forms (skincare + pharmacy) — the same
// window.open + document.write + window.print pattern as Demand.jsx's
// printRequisition, upgraded with the business logo + name header and HTML
// escaping (the requisition printer does not escape; user-entered text must
// never be injected raw).

import { esc } from '../../lib/escape.js'
export { esc }

export const t = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean).map(esc).join(', ')
  if (v === undefined || v === null) return '—'
  return v ? esc(v) : '—'
}

export const row = (label, value, valTag = '') => {
  const v = t(value)
  if (v === '—') return ''
  return '<tr><td class="k">' + esc(label) + '</td><td ' + valTag + '>' + v + '</td></tr>'
}

export const section = (title, pairs) => {
  const body = pairs.map(([l, v, tag]) => row(l, v, tag)).join('')
  if (!body) return ''
  return '<div class="sec"><h3>' + esc(title) + '</h3><table>' + body + '</table></div>'
}

export const sig = (dataUrl, name, date) => {
  if (!dataUrl) return ''
  return '<div class="sig"><img src="' + dataUrl + '" alt="signature" />' +
    '<div>' + esc(name || '') + (date ? ' — ' + esc(date) : '') + '</div></div>'
}

// Business logo + name/address/phone header row, shared by both templates.
export const brandHeader = (brand) => {
  const logo = brand?.logo_url
    ? '<img src="' + brand.logo_url + '" alt="' + esc(brand.name || '') + '" style="height:44px;max-width:180px;object-fit:contain" onerror="this.style.display=\'none\'" />'
    : ''
  return '<div class="head">' + logo +
    '<div class="txt"><h1>' + esc(brand?.name || '') + '</h1>' +
    '<p>' + [brand?.address, brand?.city + (brand?.state ? ', ' + brand?.state : ''), brand?.phone].filter(Boolean).map(esc).join(' · ') + '</p></div>' +
    '</div>'
}

export const openPrintWindow = (html) => {
  const w = window.open('', '_blank', 'width=760,height=600')
  w.document.write(html)
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 500)
}

const STYLE =
  'body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#0f172a;max-width:760px;margin:0 auto}' +
  '.head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f766e;padding-bottom:14px}' +
  '.head .txt h1{font-size:20px;margin:0}' +
  '.head .txt p{margin:2px 0 0;font-size:12px;color:#555}' +
  'h2{font-size:15px;margin:18px 0 4px;color:#0f766e;text-transform:uppercase;letter-spacing:0.4px}' +
  '.meta{font-size:13px;color:#555;margin:14px 0}' +
  '.sec{margin-top:14px;page-break-inside:avoid}' +
  '.sec h3{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;background:#f1f5f9;padding:7px 10px;margin:0;border-radius:6px}' +
  'table{width:100%;border-collapse:collapse;font-size:13px}' +
  'td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}' +
  'td.k{width:42%;color:#64748b;font-weight:700}' +
  '.prods{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
  '.prod{background:#f1f5f9;border-radius:8px;padding:6px 10px;font-size:12px}' +
  '.sig{margin-top:18px}' +
  '.sig img{height:60px;border-bottom:1px solid #94a3b8;display:block}' +
  '.sig div{font-size:11px;color:#64748b;margin-top:4px}' +
  '.sigs{display:flex;gap:48px;margin-top:24px;flex-wrap:wrap}' +
  '.sigs .col{flex:1;min-width:220px}' +
  '.foot{margin-top:28px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px}' +
  '@media print{body{padding:16px}}'

const parseData = (c) => {
  try { return typeof c.data === 'string' ? JSON.parse(c.data) : (c.data || {}) } catch (e) { return {} }
}

const recProducts = (c) => {
  if (Array.isArray(c.recommended_products)) return c.recommended_products
  try { return JSON.parse(c.recommended_products || '[]') } catch (e) { return [] }
}

// ── SKINCARE & AESTHETIC ─────────────────────────────────────────────────────

export function printConsultation(c, brand) {
  const d = parseData(c)
  const g = (k) => d[k] || {}
  const ci = g('client_info'), ec = g('emergency_contact'), sc = g('skin_concerns'),
    sh = g('skin_history'), rt = g('routine'), mh = g('medical_history'),
    al = g('allergies'), ls = g('lifestyle'), fe = g('female'),
    co = g('consent'), as = g('assessment')

  const prods = recProducts(c)

  const html =
    '<html><head><title>Consultation — ' + esc(c.client_name || '') + '</title>' +
    '<style>' + STYLE + '</style></head><body>' +
    brandHeader(brand) +
    '<h2>Skin &amp; Aesthetic Consultation Form</h2>' +
    '<div class="meta">Client: <strong>' + esc(c.client_name || '') + '</strong> · Date: ' + esc(c.consultation_date || '—') + ' · Therapist: ' + esc(c.provider_name || '—') + '</div>' +

    section('Client Information', [
      ['Full Name', ci.full_name], ['Date of Birth', ci.dob], ['Age', ci.age],
      ['Phone', ci.phone], ['Email', ci.email], ['Address', ci.address],
      ['Occupation', ci.occupation], ['Date', ci.date],
    ]) +
    section('Emergency Contact', [
      ['Name', ec.name], ['Relationship', ec.relationship], ['Phone', ec.phone],
    ]) +
    section('Skin Concerns', [
      ['Concerns', sc.selected], ['Other', sc.other],
    ]) +
    section('Skin History', [
      ['Skin Type', sh.skin_type], ['Current Symptoms', sh.symptoms],
      ['Had a Facial Before?', sh.had_facial ? (sh.had_facial === 'yes' ? 'Yes' + (sh.facial_date ? ' (' + t(sh.facial_date) + ')' : '') : 'No') : ''],
      ['Past Treatments', sh.past_treatments], ['Other Treatments', sh.other_treatment],
    ]) +
    section('Current Skincare Routine', [
      ['Cleanser', rt.cleanser], ['Toner', rt.toner], ['Serum', rt.serum],
      ['Moisturizer', rt.moisturizer], ['Sunscreen', rt.sunscreen],
      ['Exfoliant', rt.exfoliant], ['Other Products', rt.other],
    ]) +
    section('Medical History', [
      ['Conditions', mh.selected], ['Other', mh.other],
    ]) +
    section('Allergies', [
      ['Allergies', al.selected], ['Specify', al.specify],
    ]) +
    section('Lifestyle', [
      ['Water Intake', ls.water], ['Sleep', ls.sleep], ['Stress Level', ls.stress],
      ['Smoker', ls.smoker === 'yes' ? 'Yes' : ls.smoker === 'no' ? 'No' : ''],
      ['Sunscreen Use', ls.sunscreen_frequency],
    ]) +
    section('For Female Clients', [
      ['Pregnant / Breastfeeding', fe.pregnant === 'yes' ? 'Yes' : fe.pregnant === 'no' ? 'No' : ''],
      ['On Hormonal Contraceptives', fe.contraceptives === 'yes' ? 'Yes' : fe.contraceptives === 'no' ? 'No' : ''],
    ]) +
    section('Therapist Assessment', [
      ['Skin Type', as.skin_type], ['Skin Condition', as.skin_condition],
      ['Fitzpatrick Skin Type', as.fitzpatrick], ['Treatment Recommended', as.treatment_recommended],
      ['Homecare Plan', as.homecare_plan],
      ['Facial / Other Care Recommendations', as.facial_care_recommendations],
      ['Instructions', as.instructions],
    ]) +

    '<div class="sec"><h3>Products Recommended</h3>' +
    (prods.length
      ? '<div class="prods">' + prods.map(p => '<span class="prod">' + t(p.name) + '</span>').join('') + '</div>'
      : '<table><tr><td>—</td></tr></table>') +
    '</div>' +

    '<div class="sec"><h3>Consent</h3><table>' +
    row('I consent to the consultation and treatment plan and confirm the information above is accurate.', co.agreed ? 'Yes' : '', '') +
    '</table></div>' +
    '<div class="sigs">' +
    '<div class="col"><div class="sec" style="margin-top:0"><h3>Client Signature</h3></div>' + sig(co.signature, ci.full_name, co.date) + '</div>' +
    '<div class="col"><div class="sec" style="margin-top:0"><h3>Therapist Signature</h3></div>' + sig(as.therapist_signature, as.therapist_name, c.consultation_date) + '</div>' +
    '</div>' +

    '<div class="foot">Generated by CareHub · ' + new Date().toLocaleDateString('en-NG', { dateStyle: 'medium' }) + '</div>' +
    '<script>window.onload = function(){ window.print() }</script>' +
    '</body></html>'

  openPrintWindow(html)
}

// ── PHARMACY (community pharmacy) ────────────────────────────────────────────

export function printPharmacyConsultation(c, brand) {
  const d = parseData(c)
  const g = (k) => d[k] || {}
  const ci = g('client_info'), ty = g('type_of_consultation'), pc = g('presenting_complaint'),
    mr = g('med_review'), mh = g('medical_history'), al = g('allergies'),
    fe = g('female'), vt = g('vitals'), as = g('assessment'),
    co = g('consent'), ph = g('pharmacist')

  const prods = recProducts(c)
  const medRows = Array.isArray(mr.rows) ? mr.rows : []
  const types = ty.selected || []

  const typeLabel = (k) => ({
    new_symptom_otc: 'New Symptom / OTC Request',
    medication_review: 'Medication Therapy Review',
    chronic_disease: 'Chronic Disease Monitoring',
    other: 'Other',
  }[k] || k)

  const html =
    '<html><head><title>Pharmacy Consultation — ' + esc(c.client_name || '') + '</title>' +
    '<style>' + STYLE + '</style></head><body>' +
    brandHeader(brand) +
    '<h2>Pharmacy Consultation Form</h2>' +
    '<div class="meta">Client: <strong>' + esc(c.client_name || '') + '</strong> · Date: ' + esc(c.consultation_date || '—') + ' · Pharmacist: ' + esc(c.provider_name || '—') + '</div>' +

    section('Client Information', [
      ['Full Name', ci.full_name], ['Date of Birth', ci.dob], ['Age', ci.age],
      ['Phone', ci.phone], ['Email', ci.email], ['Address', ci.address],
      ['Occupation', ci.occupation], ['Weight', ci.weight], ['Blood Group', ci.blood_group],
      ['Date', ci.date],
    ]) +
    section('Type of Consultation', [
      ['Type', types.map(typeLabel)],
      ['Other (specify)', ty.other_text],
    ]) +
    section('Presenting Complaint', [
      ['Symptom(s) described', pc.symptom], ['Duration', pc.duration],
      ['Severity', pc.severity], ['Associated symptoms', pc.associated],
      ['Self-treatment already tried', pc.self_treatment],
      ['Red-flag check', pc.red_flags],
    ]) +
    '<div class="sec"><h3>Medication Therapy Review</h3>' +
    (medRows.length
      ? '<table><tr style="background:#f1f5f9"><td style="font-weight:700">Drug</td><td style="font-weight:700">Dose</td><td style="font-weight:700">Frequency</td><td style="font-weight:700">Prescriber</td><td style="font-weight:700">Indication</td><td style="font-weight:700">Start</td><td style="font-weight:700">Adherence</td></tr>' +
        medRows.map(r => '<tr><td>' + t(r.drug) + '</td><td>' + t(r.dose) + '</td><td>' + t(r.frequency) + '</td><td>' + t(r.prescriber) + '</td><td>' + t(r.indication) + '</td><td>' + t(r.start_date) + '</td><td>' + t(r.adherence) + '</td></tr>').join('') +
        '</table>'
      : '<table><tr><td>—</td></tr></table>') +
    '</div>' +
    section('Medication Review Notes', [
      ['Issues reported', mr.issues],
      ['Drug interaction / duplication check', mr.interactions],
    ]) +
    section('Medical History', [
      ['Conditions', mh.selected], ['Other', mh.other],
    ]) +
    section('Allergies', [
      ['None on file', al.none_on_file ? 'Yes' : ''],
      ['Drug allergies', al.drug_allergies], ['Food allergies', al.food_allergies],
      ['Other allergies', al.other_allergies],
    ]) +
    section('For Female Clients', [
      ['Pregnant / Breastfeeding', fe.pregnant === 'yes' ? 'Yes' : fe.pregnant === 'no' ? 'No' : ''],
    ]) +
    section('Vitals', [
      ['Blood Pressure', vt.bp], ['Blood Glucose (RBS/FBS)', vt.glucose],
      ['Temperature', vt.temp], ['Pulse', vt.pulse],
    ]) +
    section('Pharmacist Assessment & Outcome', [
      ['Assessment / problem identified', as.problem],
      ['Recommendation type', as.recommendation_type],
      ['Counseling points given', as.counseling],
      ['Referral', as.referral_yesno === 'yes' ? 'Yes — ' + t(as.referral_reason) : as.referral_yesno === 'no' ? 'No' : ''],
      ['Follow-up needed', as.followup_yesno === 'yes' ? 'Yes — ' + t(as.followup_date) : as.followup_yesno === 'no' ? 'No' : ''],
    ]) +
    '<div class="sec"><h3>Products Recommended / Dispensed</h3>' +
    (prods.length
      ? '<table><tr style="background:#f1f5f9"><td style="font-weight:700">Product</td><td style="font-weight:700">Qty</td><td style="font-weight:700">Source</td></tr>' +
        prods.map(p => '<tr><td>' + t(p.name) + '</td><td>' + t(p.qty) + '</td><td>' + t(p.source === 'dispensed' ? 'Dispensed' : 'Recommended') + '</td></tr>').join('') +
        '</table>'
      : '<table><tr><td>—</td></tr></table>') +
    '</div>' +

    '<div class="sec"><h3>Consent</h3><table>' +
    row('I consent to this consultation and counseling and confirm the information above is accurate.', co.agreed ? 'Yes' : '', '') +
    '</table></div>' +
    '<div class="sigs">' +
    '<div class="col"><div class="sec" style="margin-top:0"><h3>Client Signature</h3></div>' + sig(co.signature, ci.full_name, co.date) + '</div>' +
    '<div class="col"><div class="sec" style="margin-top:0"><h3>Pharmacist</h3></div>' + sig(ph.signature, ph.name, c.consultation_date) +
    (ph.license ? '<div class="sig" style="margin-top:8px"><div>PCN License No: ' + esc(ph.license) + '</div></div>' : '') + '</div>' +
    '</div>' +

    '<div class="foot">Generated by CareHub · ' + new Date().toLocaleDateString('en-NG', { dateStyle: 'medium' }) + '</div>' +
    '<script>window.onload = function(){ window.print() }</script>' +
    '</body></html>'

  openPrintWindow(html)
}
