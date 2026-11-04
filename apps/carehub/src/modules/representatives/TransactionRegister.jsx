import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet, Printer, Search, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Loading, Empty, ErrorState, Inp, Sel, GhostBtn, Pill } from '../../components/ui'
import { representativesRepository } from './repositories'
import { useProductSearch } from './useProductSearch'
import { defaultPeriod, validPeriod, money, registerRows, REGISTER_TYPES, repLedgerError } from './services/ledger'
import { exportRegisterXlsx, printRegister } from './services/statementExport'

const { navy, gray500, gray600, border, danger } = theme
const log = (what, e) => console.error(`[representatives] register ${what}:`, e)
const PAGE = 200

// The company's transaction register (spec 7 and 8): every supply, payment, return, transfer, adjustment and reversal
// across its representatives, filtered by representative, type, product, territory and date, with who recorded,
// approved, rejected or reversed each one. Ledger viewers only; the database checks again. Figures come from
// rep_ledger_register unchanged, so the screen, the printout and the spreadsheet agree.
export default function TransactionRegister({ companyId, companyName, representatives = [], territories = [] }) {
  const [filters, setFilters] = useState(() => ({ ...defaultPeriod(), representativeId: '', entryType: '', territoryId: '', product: null }))
  const [state, setState] = useState({ status: 'loading', register: null, error: '' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [pickingProduct, setPickingProduct] = useState(false)
  const { results, searching } = useProductSearch(companyId, productSearch, pickingProduct)
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const query = useCallback((offset) => representativesRepository.register(companyId, {
    from: filters.from, to: filters.to, representativeId: filters.representativeId, entryType: filters.entryType,
    territoryId: filters.territoryId, productId: filters.product?.id, limit: PAGE, offset,
  }), [companyId, filters])

  const load = useCallback(async () => {
    const problem = validPeriod(filters)
    if (problem) { setState({ status: 'invalid', register: null, error: problem }); return }
    setState((s) => ({ ...s, status: 'loading' }))
    try { setState({ status: 'ready', register: await query(0), error: '' }) } catch (e) {
      log('load', e); setState({ status: 'error', register: null, error: repLedgerError(e, "We couldn't load the transactions.") })
    }
  }, [filters, query])
  useEffect(() => { load() }, [load])

  async function loadMore() {
    const reg = state.register
    setLoadingMore(true)
    try {
      const next = await query(reg.entries.length)
      setState((s) => ({ ...s, register: { ...next, entries: [...s.register.entries, ...next.entries] } }))
    } catch (e) { log('more', e) }
    setLoadingMore(false)
  }

  const reg = state.register
  const rows = reg ? registerRows(reg) : []
  const t = reg?.totals || {}

  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
          <Inp id='register-from' label='From' type='date' value={filters.from} onChange={(v) => set('from', v)} />
          <Inp id='register-to' label='To' type='date' value={filters.to} onChange={(v) => set('to', v)} />
          <Sel id='register-rep' label='Representative' value={filters.representativeId} onChange={(v) => set('representativeId', v)} placeholder='All representatives'
            options={representatives.map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` }))} />
          <Sel id='register-type' label='Transaction type' value={filters.entryType} onChange={(v) => set('entryType', v)} placeholder='All types'
            options={REGISTER_TYPES.filter(([k]) => k).map(([value, label]) => ({ value, label }))} />
          {territories.length > 0 && (
            <Sel id='register-territory' label='Territory' value={filters.territoryId} onChange={(v) => set('territoryId', v)} placeholder='All territories'
              options={territories.map((x) => ({ value: x.id, label: x.name }))} />
          )}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: gray600, marginBottom: 6 }}>Product</div>
            {filters.product ? (
              <button type='button' onClick={() => set('product', null)} aria-label={`Clear product filter ${filters.product.name}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '8px 12px', border: `1px solid ${border}`, borderRadius: theme.radius.md, background: 'white', color: navy, fontWeight: 600, cursor: 'pointer', maxWidth: '100%' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filters.product.name}</span> <X size={14} aria-hidden='true' />
              </button>
            ) : (
              <GhostBtn onClick={() => setPickingProduct((p) => !p)} aria-expanded={pickingProduct} style={{ minHeight: 40 }}>
                <Search size={14} aria-hidden='true' /> All products
              </GhostBtn>
            )}
          </div>
        </div>
        {pickingProduct && !filters.product && (
          <div style={{ marginTop: 12 }}>
            <Inp id='register-product-search' label='Find a product' value={productSearch} onChange={setProductSearch} placeholder='Type a product name' />
            {searching && <div style={{ fontSize: '12px', color: gray500, marginTop: 6 }}>Searching…</div>}
            {!searching && results.length === 0 && <div style={{ fontSize: '12px', color: gray500, marginTop: 6 }}>No matching products.</div>}
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {results.slice(0, 12).map((p) => (
                <li key={p.id}><GhostBtn onClick={() => { set('product', { id: p.id, name: p.name }); setPickingProduct(false); setProductSearch('') }}>{p.name}</GhostBtn></li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <GhostBtn onClick={() => { try { printRegister(reg, companyName) } catch (e) { log('print', e) } }} disabled={!reg}><Printer size={14} aria-hidden='true' /> Print / PDF</GhostBtn>
          <GhostBtn onClick={() => exportRegisterXlsx(reg, companyName).catch((e) => log('export', e))} disabled={!reg}><FileSpreadsheet size={14} aria-hidden='true' /> Spreadsheet</GhostBtn>
        </div>
      </Card>

      {state.status === 'loading' && <Loading text='Loading transactions…' />}
      {state.status === 'invalid' && <div role='alert' style={{ color: danger, fontSize: '13px' }}>{state.error}</div>}
      {state.status === 'error' && <ErrorState message={state.error} onRetry={load} />}
      {state.status === 'ready' && reg && (rows.length === 0
        ? <Empty title='No transactions match these filters' description='Change the dates or clear a filter to see more.' />
        : (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '13px', color: gray600, marginBottom: 10 }} aria-live='polite'>
              <span><strong style={{ color: navy }}>{t.posted}</strong> posted</span>
              {t.pending > 0 && <span><strong style={{ color: navy }}>{t.pending}</strong> awaiting approval</span>}
              {t.rejected > 0 && <span><strong style={{ color: navy }}>{t.rejected}</strong> rejected</span>}
              <span>Debits <strong style={{ color: navy }}>{money(t.debits)}</strong></span>
              <span>Credits <strong style={{ color: navy }}>{money(t.credits)}</strong></span>
            </div>
            <Card style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: 820 }}>
                <caption style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: navy }}>Transactions, {reg.period.from} to {reg.period.to}</caption>
                <thead><tr style={{ background: theme.bg }}>
                  {['Date', 'Entry', 'Representative', 'Description and audit trail', 'Debit', 'Credit'].map((h, i) => (
                    <th key={h} scope='col' style={{ textAlign: i >= 4 ? 'right' : 'left', padding: '10px 12px', color: gray600, fontWeight: 700 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${border}`, verticalAlign: 'top', opacity: r.posted ? 1 : 0.7 }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.date}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: navy }}>{r.type}</div>
                        <div style={{ fontSize: '11px', color: gray500 }}>{r.entryNo}{r.reference ? ` · ${r.reference}` : ''}</div>
                        {!r.posted && <div style={{ marginTop: 4 }}><Pill label={r.status} type={r.status === 'Rejected' ? 'gray' : 'amber'} /></div>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>{r.representative}{r.territory && <div style={{ fontSize: '11px', color: gray500 }}>{r.territory}</div>}</td>
                      <td style={{ padding: '10px 12px', color: gray600 }}>{r.description}<div style={{ fontSize: '11px', color: gray500, marginTop: 2 }}>{r.audit}</div></td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.debit ? money(r.debit) : ''}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.credit ? money(r.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {reg.has_more && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <GhostBtn onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : `Show more (${rows.length} of ${t.count})`}</GhostBtn>
              </div>
            )}
          </>
        ))}
    </div>
  )
}
