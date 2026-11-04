import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, Sel, Inp, GhostBtn, TealBtn } from '../../components/ui'
import { representativesRepository } from './repositories'
import { useProductSearch } from './useProductSearch'
import { PAYMENT_METHODS, RETURN_CONDITIONS, toLines, positiveAmount, money, repLedgerError } from './services/ledger'

const { navy, gray500, border, danger, tealDeep, tealMist } = theme

const TITLES = {
  supply: 'Record a supply on credit',
  payment: 'Record a payment',
  return: 'Record returned goods',
  transfer: 'Transfer goods between representatives',
  adjustment: 'Record an adjustment',
}
const HELP = {
  centralised: {
    supply: 'The goods are recorded as in the representative\'s custody. They stay in the company stock, because the representative sells through the company POS.',
    return: 'Good goods simply leave the representative\'s custody. Damaged or expired goods are also written off the company stock.',
    transfer: 'Custody moves from one representative to the other. The company stock does not change.',
  },
  decentralised: {
    supply: 'The goods move from the company stock into the representative\'s own account at once.',
    return: 'The goods leave the representative\'s account when the return is accepted. Good goods go back into the company stock.',
    transfer: 'The goods move from one representative\'s account to the other\'s when the transfer is approved.',
  },
}

// One form for every entry type. The database checks permissions, stock and values again and does the whole job in
// one transaction; this form only collects the input and shows its refusals as sentences. Each opening gets a new
// request key, so a double tap or a retry after a lost reply is recorded once.
export default function RecordEntryModal({ show, kind, company, model, representatives, defaultRepId, canApprove, onClose, onDone }) {
  const [repId, setRepId] = useState('')
  const [toRepId, setToRepId] = useState('')
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [f, setF] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const requestKey = useRef(null)
  const withLines = kind === 'supply' || kind === 'return' || kind === 'transfer'
  const { results, searching } = useProductSearch(company?.id, search, show && withLines)
  const active = (representatives || []).filter((r) => r.status === 'active')

  useEffect(() => {
    if (!show) return
    setRepId(defaultRepId || ''); setToRepId(''); setRows([]); setSearch(''); setError(''); setSaving(false)
    setF({ method: 'cash', condition: 'good', direction: 'credit', accept: true, entryDate: '' })
    requestKey.current = representativesRepository.newRequestKey()
  }, [show, kind, defaultRepId])

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const addProduct = (p) => {
    if (rows.some((r) => r.product.id === p.id)) return
    // The company's cost is only a starting suggestion for the agreed value; the person recording sets the real one.
    setRows((rs) => [...rs, { product: p, qty: '', unitValue: p.cost_price == null ? '' : String(p.cost_price) }])
  }
  const setRow = (id, k, v) => setRows((rs) => rs.map((r) => (r.product.id === id ? { ...r, [k]: v } : r)))
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.product.id !== id))
  const parsed = withLines ? toLines(rows) : null

  async function submit() {
    if (!repId) { setError(kind === 'transfer' ? 'Choose who the goods come from.' : 'Choose a representative.'); return }
    const common = { entryDate: f.entryDate || null, reference: f.reference || '', requestKey: requestKey.current }
    let call
    if (withLines && parsed.error) { setError(parsed.error); return }
    if (kind === 'supply') call = () => representativesRepository.supply(company.id, repId, { ...common, lines: parsed.lines, note: f.note })
    if (kind === 'return') call = () => representativesRepository.returnGoods(company.id, repId, { ...common, lines: parsed.lines, condition: f.condition, accept: canApprove && f.accept, note: f.note })
    if (kind === 'transfer') {
      if (!toRepId || toRepId === repId) { setError('Choose a different representative to receive the goods.'); return }
      if (!String(f.reason || '').trim()) { setError('Give a reason for the transfer.'); return }
      call = () => representativesRepository.transfer(company.id, repId, toRepId, { ...common, lines: parsed.lines, reason: f.reason, approve: canApprove && f.accept })
    }
    if (kind === 'payment') {
      const amount = positiveAmount(f.amount)
      if (!amount) { setError('Enter an amount greater than zero.'); return }
      if (!String(f.recipient || '').trim()) { setError('Record who received the payment.'); return }
      call = () => representativesRepository.payment(company.id, repId, { ...common, amount, method: f.method, recipient: f.recipient, note: f.note })
    }
    if (kind === 'adjustment') {
      const amount = positiveAmount(f.amount)
      if (!amount) { setError('Enter an amount greater than zero.'); return }
      if (!String(f.reason || '').trim() || !String(f.reference || '').trim()) { setError('An adjustment needs a reason and a reference.'); return }
      call = () => representativesRepository.adjustment(company.id, repId, { ...common, amount, direction: f.direction, reason: f.reason })
    }
    setError(''); setSaving(true)
    try {
      const r = await call()
      onDone?.(r)
    } catch (e) {
      console.error(`[representatives] record ${kind} failed:`, e)
      setError(repLedgerError(e))
    }
    setSaving(false)
  }

  const repOptions = active.map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` }))
  const help = HELP[model]?.[kind]

  return (
    <Modal show={show} onClose={onClose} title={TITLES[kind] || 'Record'} wide
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : 'Save'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Sel id='rep-entry-rep' label={kind === 'transfer' ? 'From representative' : 'Representative'} value={repId} onChange={setRepId}
            placeholder={repOptions.length ? 'Choose…' : 'No active representatives'} options={repOptions} required />
          {kind === 'transfer' && (
            <Sel id='rep-entry-to' label='To representative' value={toRepId} onChange={setToRepId} placeholder='Choose…'
              options={repOptions.filter((o) => o.value !== repId)} required />
          )}
          <Inp id='rep-entry-date' label='Date (optional, today if blank)' type='date' value={f.entryDate} onChange={(v) => set('entryDate', v)} />
        </div>

        {withLines && (
          <div>
            <label htmlFor='rep-entry-search' style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: navy, marginBottom: 6 }}>Products</label>
            <div style={{ position: 'relative' }}>
              <Search size={15} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 13, color: gray500 }} />
              <input id='rep-entry-search' type='search' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search the company’s products'
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '14px' }} />
            </div>
            <ul aria-label='Company products' aria-busy={searching} style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, maxHeight: 160, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
              {results.map((p) => {
                const added = rows.some((r) => r.product.id === p.id)
                return (
                  <li key={p.id}>
                    <button type='button' onClick={() => addProduct(p)} disabled={added}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: 'none', borderBottom: `1px solid ${border}`, background: added ? tealMist : 'white', cursor: added ? 'default' : 'pointer', textAlign: 'left', fontSize: '13px', color: navy, minHeight: 44 }}>
                      <span>{p.name}</span><span style={{ color: gray500 }}>{added ? 'Added' : `${p.stock ?? 0} in company stock`}</span>
                    </button>
                  </li>
                )
              })}
              {!searching && results.length === 0 && <li style={{ padding: '12px', fontSize: '13px', color: gray500 }}>{search ? 'No products match your search.' : 'The company has no products yet.'}</li>}
            </ul>
            {rows.length > 0 && (
              <div role='group' aria-label='Products in this entry' style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {rows.map((r) => (
                  <div key={r.product.id} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 160px', fontSize: '13px', fontWeight: 600, color: navy, paddingBottom: 12 }}>{r.product.name}</div>
                    <Inp id={`qty-${r.product.id}`} label='Quantity' type='number' min='1' value={r.qty} onChange={(v) => setRow(r.product.id, 'qty', v)} style={{ width: 100 }} />
                    <Inp id={`unit-${r.product.id}`} label={kind === 'return' ? 'Credit per unit (₦)' : 'Agreed value per unit (₦)'} type='number' min='0'
                      value={r.unitValue} onChange={(v) => setRow(r.product.id, 'unitValue', v)} style={{ width: 170 }} />
                    <button type='button' onClick={() => removeRow(r.product.id)} aria-label={`Remove ${r.product.name}`}
                      style={{ width: 44, height: 44, border: `1px solid ${border}`, borderRadius: theme.radius.md, background: 'white', cursor: 'pointer', color: gray500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={16} aria-hidden='true' />
                    </button>
                  </div>
                ))}
                {!parsed.error && <div style={{ fontSize: '13px', color: navy, fontWeight: 700 }}>Total value: {money(parsed.total)}</div>}
              </div>
            )}
          </div>
        )}

        {kind === 'payment' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Inp id='rep-pay-amount' label='Amount (₦)' type='number' min='0' value={f.amount} onChange={(v) => set('amount', v)} required />
            <Sel id='rep-pay-method' label='Method' value={f.method} onChange={(v) => set('method', v)} options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))} />
            <Inp id='rep-pay-recipient' label='Received by' value={f.recipient} onChange={(v) => set('recipient', v)} placeholder='e.g. Accounts desk' required />
          </div>
        )}
        {kind === 'return' && (
          <Sel id='rep-return-condition' label='Condition' value={f.condition} onChange={(v) => set('condition', v)} options={RETURN_CONDITIONS.map(([value, label]) => ({ value, label }))} />
        )}
        {kind === 'transfer' && (
          <Inp id='rep-transfer-reason' label='Reason' value={f.reason} onChange={(v) => set('reason', v)} placeholder='e.g. Bayo covers Surulere this week' required />
        )}
        {kind === 'adjustment' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Sel id='rep-adj-direction' label='Effect' value={f.direction} onChange={(v) => set('direction', v)}
              options={[{ value: 'credit', label: 'Reduce what they owe (credit)' }, { value: 'debit', label: 'Increase what they owe (debit)' }]} />
            <Inp id='rep-adj-amount' label='Amount (₦)' type='number' min='0' value={f.amount} onChange={(v) => set('amount', v)} required />
            <Inp id='rep-adj-reason' label='Reason' value={f.reason} onChange={(v) => set('reason', v)} required />
          </div>
        )}
        {(kind === 'return' || kind === 'transfer') && canApprove && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '13px', color: navy, minHeight: 44 }}>
            <input type='checkbox' checked={!!f.accept} onChange={(e) => set('accept', e.target.checked)} />
            {kind === 'return' ? 'Accept this return now (otherwise it waits for approval)' : 'Approve this transfer now (otherwise it waits for approval)'}
          </label>
        )}
        <Inp id='rep-entry-reference' label={kind === 'adjustment' ? 'Reference' : 'Reference (optional)'} value={f.reference} onChange={(v) => set('reference', v)}
          placeholder={kind === 'payment' ? 'e.g. bank transaction ID' : 'e.g. invoice or memo number'} required={kind === 'adjustment'} />
        {(kind === 'supply' || kind === 'payment' || kind === 'return') && (
          <Inp id='rep-entry-note' label='Note (optional)' value={f.note} onChange={(v) => set('note', v)} />
        )}
        {help && <div style={{ fontSize: '12px', color: tealDeep, lineHeight: 1.5 }}>{help}</div>}
        {error && <div role='alert' style={{ fontSize: '13px', color: danger }}>{error}</div>}
      </div>
    </Modal>
  )
}
