import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { theme } from '../../styles/theme'
import { SectionHead, Card, Pill, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'
import { isManagerRole } from '../../lib/permissions'
import { locationsRepository } from '../locations/repositories'
import { transferRepository } from './repositories'
import { STATUS, directionFor, totals, locationName, transferError } from './transferRules'
import NewTransferModal from './NewTransferModal'
import TransferDetailModal from './TransferDetailModal'

const { navy, gray500, gray600, border, tealDeep } = theme
const log = (what, e) => console.error(`[transfers] ${what}:`, e)
const FILTERS = [['all', 'All'], ['in', 'Incoming'], ['out', 'Outgoing'], ['open', 'In transit']]

// Moving stock between the locations of a business (Product-Catalogue-Design.md, phase 3). This location sees the
// transfers it sent and the ones coming to it. The owner and managers send and cancel; anyone working here receives.
export default function StockTransfers({ brand, role, loadProducts }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const mainId = brand?.parent_business_id || brand?.id
  const canSend = role === 'Owner' || isManagerRole(role)

  const [locations, setLocations] = useState([])
  const [state, setState] = useState({ status: 'loading', transfers: [], available: true })
  const [filter, setFilter] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!mainId) return
    locationsRepository.getAll(mainId).then((l) => setLocations(l || [])).catch((e) => log('locations', e))
  }, [mainId])

  const load = useCallback(async () => {
    if (!brand?.id) return
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await transferRepository.list(brand.id)
      setState({ status: 'ready', transfers: r.transfers, available: r.available })
    } catch (e) {
      log('load', e)
      setState((s) => ({ ...s, status: 'error' }))
    }
  }, [brand?.id])
  useEffect(() => { load() }, [load])

  const here = locations.find((l) => l.id === brand?.id) || brand
  const shown = useMemo(() => state.transfers.filter((t) => {
    if (filter === 'in') return directionFor(t, brand?.id) === 'in'
    if (filter === 'out') return directionFor(t, brand?.id) === 'out'
    if (filter === 'open') return t.status === 'in_transit'
    return true
  }), [state.transfers, filter, brand?.id])
  const waiting = state.transfers.filter((t) => t.status === 'in_transit' && t.to_branch_id === brand?.id).length
  const open = state.transfers.find((t) => t.id === openId) || null

  async function send(toId, lines, note) {
    setBusy(true)
    try {
      const r = await transferRepository.send(brand.id, toId, lines, note)
      showToast(`Transfer ${r?.transfer_no || ''} sent to ${locationName(locations.find((l) => l.id === toId))}.`, { type: 'success' })
      setShowNew(false)
      load(); loadProducts?.()
    } catch (e) { log('send', e); showToast(transferError(e), { type: 'error', duration: 8000 }) }
    setBusy(false)
  }

  async function receive(transfer, lines, note) {
    setBusy(true)
    try {
      const r = await transferRepository.receive(transfer.id, lines, note)
      showToast(r?.shortfall > 0 ? `Received, with ${r.shortfall} unit(s) short. The sender has been told.` : 'Received. The stock has been added here.', { type: 'success' })
      setOpenId(null)
      load(); loadProducts?.()
    } catch (e) { log('receive', e); showToast(transferError(e), { type: 'error', duration: 8000 }) }
    setBusy(false)
  }

  async function cancel(transfer, reason) {
    setBusy(true)
    try {
      await transferRepository.cancel(transfer.id, reason)
      showToast('Transfer cancelled. The stock is back here.', { type: 'success' })
      setOpenId(null)
      load(); loadProducts?.()
    } catch (e) { log('cancel', e); showToast(transferError(e), { type: 'error', duration: 8000 }) }
    setBusy(false)
  }

  const onlyOne = locations.length > 0 && locations.length < 2

  return (
    <div>
      <SectionHead title='Stock Transfers' sub={`Move stock between your locations. You are at ${locationName(here)}.`}
        btn={canSend && state.available && !onlyOne ? '+ Send stock' : undefined} onBtn={() => setShowNew(true)} />

      {waiting > 0 && (
        <div role='status' style={{ marginBottom: 14, padding: '12px 14px', borderRadius: theme.radius.md, background: theme.warningBg, color: theme.warning, fontSize: '13px', fontWeight: 600 }}>
          {waiting} transfer{waiting === 1 ? ' is' : 's are'} on the way here. Open {waiting === 1 ? 'it' : 'each one'} to confirm what arrived.
        </div>
      )}

      <div role='tablist' aria-label='Show transfers' style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} role='tab' aria-selected={filter === k} onClick={() => setFilter(k)}
            style={{ padding: '8px 14px', minHeight: 40, borderRadius: 999, border: `1px solid ${filter === k ? tealDeep : border}`, background: filter === k ? tealDeep : 'white', color: filter === k ? 'white' : gray600, fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {state.status === 'loading' && !state.transfers.length ? <Loading text='Loading transfers…' />
        : state.status === 'error' ? <ErrorState message="We couldn't load the transfers. Check your connection and try again." onRetry={load} />
        : !state.available ? <Empty icon={<ArrowLeftRight size={40} aria-hidden='true' />} message='Stock transfers are available once the latest database update is installed.' />
        : onlyOne ? <Empty icon={<ArrowLeftRight size={40} aria-hidden='true' />} title='You have one location' description='Add a branch in Locations to move stock between them.' />
        : shown.length === 0 ? (
          <Empty icon={<ArrowLeftRight size={40} aria-hidden='true' />} cause={filter === 'all' ? 'none' : 'filtered'}
            message={filter === 'all' ? 'No transfers yet' : 'No transfers here'}
            action={filter === 'all' && canSend ? '+ Send stock' : filter !== 'all' ? 'Show all' : undefined}
            onAction={() => (filter === 'all' ? setShowNew(true) : setFilter('all'))} />
        ) : (
          <ul aria-busy={state.status === 'loading'} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((t) => {
              const dir = directionFor(t, brand?.id)
              const s = STATUS[t.status] || { label: t.status, pill: 'gray' }
              const tt = totals(t)
              const other = locations.find((l) => l.id === (dir === 'in' ? t.from_branch_id : t.to_branch_id))
              const Icon = dir === 'in' ? ArrowDownLeft : ArrowUpRight
              return (
                <li key={t.id}>
                  <Card style={{ padding: 0 }}>
                    <button type='button' onClick={() => setOpenId(t.id)} aria-label={`Open transfer ${t.transfer_no}`}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                      <span aria-hidden='true' style={{ width: 36, height: 36, borderRadius: theme.radius.md, background: theme.tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={18} /></span>
                      <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 800, fontSize: '14px', color: navy }}>{dir === 'in' ? `From ${locationName(other)}` : `To ${locationName(other)}`}</span>
                        <span style={{ display: 'block', fontSize: '12px', color: gray500, marginTop: 2 }}>
                          {t.transfer_no} · {tt.items} item{tt.items === 1 ? '' : 's'}, {tt.sent} unit{tt.sent === 1 ? '' : 's'} · {new Date(t.sent_at || t.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                          {tt.shortfall > 0 && <span style={{ color: theme.warning }}> · {tt.shortfall} short</span>}
                        </span>
                      </span>
                      <Pill label={t.status === 'in_transit' && dir === 'in' ? 'To receive' : s.label} type={s.pill} />
                    </button>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}

      <NewTransferModal show={showNew} fromLocation={here} locations={locations} sending={busy} onSend={send} onClose={() => setShowNew(false)} />
      {open && (
        <TransferDetailModal transfer={open} locationId={brand?.id} locations={locations} canCancel={canSend} busy={busy}
          onReceive={receive} onCancel={cancel} onClose={() => setOpenId(null)} />
      )}
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
