import { useState } from 'react'
import { theme } from '../../../styles/theme'
import { suggestionRepository, SUGGESTION_TYPES } from './repository.js'

const { navy, gray500, border, danger, tealDeep, tealMist, bg } = theme

// Tell the CareHub team about a business the directory does not know. Shown inline under the place suggestions in
// the log form. The suggestion is separate from the visit: it changes nothing about the report being logged. The
// current GPS fix is attached so the team can find the place; no contact details are asked for.
export default function SuggestBusiness({ businessId, gps, areaLabel, onClose, onSent, repo = suggestionRepository }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [address, setAddress] = useState(areaLabel || '')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function send() {
    if (name.trim().length < 2) { setProblem('Enter the business name.'); return }
    if (!type) { setProblem('Choose what kind of business it is.'); return }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setProblem('Suggesting a business needs a connection.'); return }
    setProblem('')
    setSending(true)
    try {
      await repo.create(businessId, { name, business_type: type, address, latitude: gps.lat, longitude: gps.lng, note })
      setSent(true)
      if (onSent) onSent()
    } catch (e) {
      setProblem(e && e.code === 'TOO_MANY'
        ? 'You have sent many suggestions today. Try again tomorrow.'
        : 'The suggestion was not sent: ' + ((e && e.message) || 'request failed'))
    }
    setSending(false)
  }

  const box = { padding: '12px', borderRadius: '10px', border: '1px solid ' + border, background: 'white', marginTop: '8px' }
  const control = { width: '100%', padding: '9px 10px', borderRadius: '8px', border: '1px solid ' + border, fontSize: '13px', boxSizing: 'border-box', background: 'white', color: navy }
  const label = { display: 'block', fontSize: '11px', fontWeight: 700, color: gray500, margin: '8px 0 3px' }
  const btn = { fontSize: '12px', fontWeight: 800, padding: '9px 14px', borderRadius: '8px', cursor: 'pointer', minHeight: '36px' }

  if (sent) {
    return (
      <div role='status' style={{ ...box, background: tealMist, color: tealDeep, fontSize: '12.5px' }}>
        Thanks. The CareHub team will review it.{' '}
        <button type='button' onClick={onClose} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 800, cursor: 'pointer', padding: 0 }}>Close</button>
      </div>
    )
  }

  return (
    <div style={box}>
      <div style={{ fontSize: '12.5px', fontWeight: 800, color: navy }}>Suggest a business for the CareHub directory</div>
      <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>The CareHub team checks it before it is listed. Your report is not affected.</div>
      {!gps ? (
        <div role='status' style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', background: bg, fontSize: '12.5px', color: gray500 }}>
          Your position is needed to suggest a business.{' '}
          <button type='button' onClick={onClose} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Close</button>
        </div>
      ) : (
        <>
          <label style={label} htmlFor='suggest-name'>Business name</label>
          <input id='suggest-name' aria-label='Business name' value={name} maxLength={200} onChange={(e) => setName(e.target.value)} style={control} />
          <label style={label} htmlFor='suggest-type'>Type</label>
          <select id='suggest-type' aria-label='Type' value={type} onChange={(e) => setType(e.target.value)} style={control}>
            <option value=''>Choose…</option>
            {SUGGESTION_TYPES.map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}
          </select>
          <label style={label} htmlFor='suggest-address'>Address</label>
          <input id='suggest-address' aria-label='Address' value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} style={control} />
          <label style={label} htmlFor='suggest-note'>Note (optional)</label>
          <textarea id='suggest-note' aria-label='Note' value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} style={{ ...control, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ fontSize: '11px', color: gray500, marginTop: '6px' }}>Your current position is sent with it.</div>
          {problem && <div role='alert' style={{ fontSize: '12px', color: danger, marginTop: '8px' }}>{problem}</div>}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            <button type='button' onClick={send} disabled={sending} style={{ ...btn, border: 'none', background: tealDeep, color: 'white' }}>{sending ? 'Sending…' : 'Send suggestion'}</button>
            <button type='button' onClick={onClose} style={{ ...btn, border: '1px solid ' + border, background: 'white', color: navy }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
