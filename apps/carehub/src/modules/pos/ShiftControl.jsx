import { BUSINESS_TZ } from '../../lib/businessDay'
import { useEffect, useState } from 'react'
import { Clock, LogIn } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Inp } from '../../components/ui'
import { fmt } from '../../lib/utils'
import { shiftRepository, paymentRepository } from './repositories'
import { expectedCash, parseDbTime } from './salesReport'

const { tealDeep, tealMist, navy, gray500, gray600, border, bg, danger, success } = theme

const cleanServerError = (e) => String(e?.message || e).replace(/^Supabase error \(\d{3}\):\s*/, '')
const timeOnly = (v) => parseDbTime(v)?.toLocaleTimeString('en-NG', { timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit' }) || ''

// Optional till shifts. Opening one is never required to sell: a sale made with
// no open shift is reported under "No shift". The database stamps the shift on
// every sale and payment, and computes expected cash when the shift closes.
//
// Props: brand, userId (auth user id; undefined while resolving), showToast,
// onChange() after an open or close so the report reloads.
export default function ShiftControl({ brand, userId, showToast, onChange }) {
  const [state, setState] = useState({ loading: true, available: true, shift: null })
  const [mode, setMode] = useState(null) // null | 'open' | 'close' | 'closed'
  const [float, setFloat] = useState('')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!brand?.id || userId === undefined) return
    try {
      const r = await shiftRepository.getOpen(brand.id, userId)
      setState({ loading: false, available: r.available, shift: r.shift })
    } catch (e) {
      console.warn('[pos] could not load the open shift:', e)
      setState({ loading: false, available: true, shift: null, error: true })
    }
  }
  useEffect(() => { load() }, [brand?.id, userId])

  async function startClose() {
    setMode('close'); setCounted(''); setNote(''); setPreview(null)
    try {
      const rows = await paymentRepository.getForShift(brand.id, state.shift.id)
      setPreview(expectedCash(state.shift, rows))
    } catch (e) {
      console.warn('[pos] could not preview expected cash:', e)
    }
  }

  async function openShift() {
    const amount = float === '' ? 0 : Number(float)
    if (!Number.isFinite(amount) || amount < 0) { showToast('Enter the opening cash as a number, or leave it empty for none.', { type: 'warning' }); return }
    setBusy(true)
    try {
      await shiftRepository.open(brand.id, amount)
      showToast('Shift opened. Sales and payments you take are now recorded against it.', { type: 'success' })
      setMode(null); setFloat('')
      await load(); onChange?.()
    } catch (e) {
      showToast(cleanServerError(e), { type: 'error' })
    } finally { setBusy(false) }
  }

  async function closeShift() {
    const amount = Number(counted)
    if (counted === '' || !Number.isFinite(amount) || amount < 0) { showToast('Count the cash in the drawer and enter the amount.', { type: 'warning' }); return }
    setBusy(true)
    try {
      const r = await shiftRepository.close(state.shift.id, amount, note.trim())
      setResult(r); setMode('closed')
      await load(); onChange?.()
    } catch (e) {
      showToast(cleanServerError(e), { type: 'error' })
    } finally { setBusy(false) }
  }

  // Nothing to offer until the accounting migration is applied.
  if (state.loading || !state.available) return null

  const chip = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: theme.radius.md, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
  const diff = result ? Number(result.difference) : 0

  return (
    <>
      {state.shift ? (
        <button onClick={startClose} style={{ ...chip, border: `1px solid ${tealDeep}`, background: tealMist, color: tealDeep }}
          aria-label={`Shift open since ${timeOnly(state.shift.opened_at)}. Close shift`}>
          <Clock size={14} aria-hidden='true' /> Shift since {timeOnly(state.shift.opened_at)} · Close
        </button>
      ) : (
        <button onClick={() => setMode('open')} style={{ ...chip, border: `1px solid ${border}`, background: 'white', color: navy }}>
          <LogIn size={14} aria-hidden='true' /> Open shift
        </button>
      )}

      <Modal show={mode === 'open'} onClose={() => setMode(null)} title='Open a shift'
        footer={<><GhostBtn onClick={() => setMode(null)} style={{ flex: 1, padding: 12 }}>Cancel</GhostBtn><TealBtn onClick={openShift} disabled={busy} style={{ flex: 1, padding: 12 }}>{busy ? 'Opening…' : 'Open shift'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: gray600, lineHeight: 1.5 }}>
            Every sale, repayment and refund you record until you close the shift is tied to it, so the cash can be counted against it at the end.
          </div>
          <Inp label='Opening cash in the drawer (₦)' type='number' min='0' value={float} onChange={setFloat} placeholder='0' />
        </div>
      </Modal>

      <Modal show={mode === 'close'} onClose={() => setMode(null)} title='Close shift'
        footer={<><GhostBtn onClick={() => setMode(null)} style={{ flex: 1, padding: 12 }}>Cancel</GhostBtn><TealBtn onClick={closeShift} disabled={busy} style={{ flex: 1, padding: 12 }}>{busy ? 'Closing…' : 'Close shift'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: 12, borderRadius: theme.radius.md, background: bg, fontSize: 13, color: gray600, lineHeight: 1.6 }}>
            Opened at {timeOnly(state.shift?.opened_at)} with {fmt(state.shift?.opening_float)}.<br />
            Expected cash in the drawer: <strong style={{ color: navy }}>{preview == null ? 'calculating…' : fmt(preview)}</strong>
            <div style={{ fontSize: 11.5, color: gray500 }}>Opening cash + cash taken − cash refunded during this shift.</div>
          </div>
          <Inp label='Cash counted in the drawer (₦)' type='number' min='0' value={counted} onChange={setCounted} placeholder='0' required />
          <Inp label='Note (optional)' value={note} onChange={setNote} placeholder='e.g. ₦500 paid out for fuel' />
        </div>
      </Modal>

      <Modal show={mode === 'closed'} onClose={() => setMode(null)} title='Shift closed'
        footer={<TealBtn onClick={() => setMode(null)} style={{ flex: 1, padding: 12 }}>Done</TealBtn>}>
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
            <Line label='Expected cash' value={fmt(result.expected_cash)} />
            <Line label='Counted cash' value={fmt(result.counted_cash)} />
            <Line label={diff === 0 ? 'Balanced' : diff > 0 ? 'Over by' : 'Short by'} value={fmt(Math.abs(diff))}
              color={diff === 0 ? success : danger} strong />
          </div>
        )}
      </Modal>
    </>
  )
}

function Line({ label, value, color = navy, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: gray600 }}>{label}</span>
      <span style={{ color, fontWeight: strong ? 900 : 700 }}>{value}</span>
    </div>
  )
}

