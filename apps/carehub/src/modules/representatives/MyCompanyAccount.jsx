import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { theme } from '../../styles/theme'
import { SectionHead, Card, Loading, Empty, ErrorState, GhostBtn, useToast, Toast } from '../../components/ui'
import { representativesRepository } from './repositories'
import { MODELS, money, positionText, repLedgerError } from './services/ledger'
import RepStatement from './RepStatement'

const { navy, gray500, gray600, border, tealDeep } = theme

// A representative's own page: their account statement with the company, and (when the company runs Decentralised)
// the company's official catalogue and prices. The catalogue is read-only: sales happen in the representative's own
// account, never in the company's.
export default function MyCompanyAccount({ repProfile }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const decentralised = repProfile?.operating_model === 'decentralised'
  const [tab, setTab] = useState('statement')

  if (!repProfile) return <Empty title='No representative account' description='Your company has not added you as a representative.' />
  const model = MODELS[repProfile.operating_model] || MODELS.centralised
  const tabs = [['statement', 'My statement'], ...(decentralised ? [['catalogue', 'Company catalogue']] : [])]

  return (
    <div>
      <SectionHead title='My company account' sub={`${repProfile.company_name} · ${model.label} operation`} />
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: '12px', color: gray500 }}>Current balance with {repProfile.company_name}</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: Number(repProfile.balance) > 0 ? theme.warning : navy }}>{money(repProfile.balance)}</div>
        <div style={{ fontSize: '13px', color: gray600 }}>{positionText(repProfile.balance)} · {repProfile.rep_code}</div>
      </Card>
      {tabs.length > 1 && (
        <div role='tablist' aria-label='My company account' style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {tabs.map(([id, label]) => (
            <button key={id} type='button' role='tab' aria-selected={tab === id} onClick={() => setTab(id)}
              style={{ padding: '8px 14px', minHeight: 40, borderRadius: theme.radius.full, border: `1px solid ${tab === id ? tealDeep : border}`,
                background: tab === id ? tealDeep : 'white', color: tab === id ? 'white' : navy, fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'statement' && <RepStatement repId={repProfile.id} title='My statement' showToast={showToast} />}
      {tab === 'catalogue' && decentralised && <CompanyCatalogue companyName={repProfile.company_name} />}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

function CompanyCatalogue({ companyName }) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState({ status: 'loading', products: [], error: '', more: false })
  const [offset, setOffset] = useState(0)

  const load = useCallback(async (q, from) => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await representativesRepository.companyCatalog(q, from)
      const rows = r?.products || []
      setState((s) => ({ status: 'ready', products: from ? [...s.products, ...rows] : rows, error: '', more: rows.length === 50 }))
    } catch (e) {
      console.error('[representatives] catalogue:', e)
      setState({ status: 'error', products: [], error: repLedgerError(e, "We couldn't load the company catalogue."), more: false })
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); load(search, 0) }, 250)
    return () => clearTimeout(t)
  }, [search, load])

  return (
    <div>
      <p style={{ fontSize: '13px', color: gray600, marginTop: 0 }}>The official products and prices of {companyName}. Your own selling prices are set in your account’s Stock Management.</p>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <label htmlFor='catalogue-search' style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search the company catalogue</label>
        <Search size={15} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 13, color: gray500 }} />
        <input id='catalogue-search' type='search' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search by name or generic name'
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '14px' }} />
      </div>
      {state.status === 'error' && <ErrorState message={state.error} onRetry={() => load(search, 0)} />}
      {state.status !== 'error' && state.products.length === 0 && state.status === 'ready' && (
        <Empty title={search ? 'No products match your search' : 'The company has no products listed yet'} />
      )}
      {state.products.length > 0 && (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <caption style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: navy }}>Company catalogue</caption>
            <thead><tr style={{ background: theme.bg }}>
              <th scope='col' style={{ textAlign: 'left', padding: '10px 12px', color: gray600 }}>Product</th>
              <th scope='col' style={{ textAlign: 'left', padding: '10px 12px', color: gray600 }}>Category</th>
              <th scope='col' style={{ textAlign: 'right', padding: '10px 12px', color: gray600 }}>Company price</th>
            </tr></thead>
            <tbody>
              {state.products.map((p) => (
                <tr key={p.id} style={{ borderTop: `1px solid ${border}` }}>
                  <td style={{ padding: '10px 12px', color: navy }}><div style={{ fontWeight: 600 }}>{p.name}</div>{p.generic_name && <div style={{ fontSize: '12px', color: gray500 }}>{p.generic_name}</div>}</td>
                  <td style={{ padding: '10px 12px', color: gray600 }}>{p.category || ''}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(p.price)}{p.price_unit ? ` / ${p.price_unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {state.status === 'loading' && <Loading text='Loading catalogue…' />}
      {state.status === 'ready' && state.more && (
        <div style={{ marginTop: 12 }}><GhostBtn onClick={() => { const next = offset + 50; setOffset(next); load(search, next) }}>Show more</GhostBtn></div>
      )}
    </div>
  )
}
