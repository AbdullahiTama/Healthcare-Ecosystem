import { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { Modal, Pill, Inp, GhostBtn, TealBtn, RedBtn } from '../../components/ui'
import { STATUS, totals, checkReceived, locationName } from './transferRules'

const { navy, gray500, gray600, border, bg, danger, warning } = theme
const when = (d) => (d ? new Date(d).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '')

// One transfer: its items, what was sent and received, and who did what. The receiving location confirms what
// arrived (anything short is recorded); the sending location's owner or a manager can cancel it while in transit.
export default function TransferDetailModal({ transfer, locationId, locations, canCancel, busy, onReceive, onCancel, onClose }) {
  const [received, setReceived] = useState({})
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setReceived({}); setNote(''); setReason(''); setConfirmCancel(false); setError('') }, [transfer?.id])
  if (!transfer) return null

  const lines = transfer.stock_transfer_lines || []
  const byId = (id) => locations.find((l) => l.id === id)
  const status = STATUS[transfer.status] || { label: transfer.status, pill: 'gray' }
  const t = totals(transfer)
  const inTransit = transfer.status === 'in_transit'
  const canReceive = inTransit && transfer.to_branch_id === locationId
  const mayCancel = inTransit && transfer.from_branch_id === locationId && canCancel

  function receive() {
    const r = checkReceived(lines, received)
    if (r.error) { setError(r.error); return }
    setError('')
    onReceive(transfer, r.lines, note)
  }

  const footer = canReceive
    ? <><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn><TealBtn onClick={receive} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Saving…' : 'Confirm received'}</TealBtn></>
    : mayCancel && confirmCancel
      ? <><GhostBtn onClick={() => setConfirmCancel(false)} style={{ flex: 1, padding: '12px' }}>Keep it</GhostBtn><RedBtn onClick={() => onCancel(transfer, reason)} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Cancelling…' : 'Cancel transfer'}</RedBtn></>
      : <><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>{mayCancel && <RedBtn onClick={() => setConfirmCancel(true)} style={{ flex: 1, padding: '12px' }}>Cancel transfer…</RedBtn>}</>

  return (
    <Modal show onClose={onClose} title={`Transfer ${transfer.transfer_no || ''}`} wide footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Pill label={status.label} type={status.pill} />
          <span style={{ fontSize: '14px', fontWeight: 700, color: navy }}>{locationName(byId(transfer.from_branch_id))} → {locationName(byId(transfer.to_branch_id))}</span>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0, fontSize: '12.5px', color: gray600 }}>
          <dt>Sent</dt><dd style={{ margin: 0 }}>{when(transfer.sent_at || transfer.created_at)}{transfer.sent_by_name ? ` by ${transfer.sent_by_name}` : ''}</dd>
          {transfer.received_at && <><dt>Received</dt><dd style={{ margin: 0 }}>{when(transfer.received_at)}{transfer.received_by_name ? ` by ${transfer.received_by_name}` : ''}</dd></>}
          {transfer.cancelled_at && <><dt>Cancelled</dt><dd style={{ margin: 0 }}>{when(transfer.cancelled_at)}{transfer.cancel_reason ? ` · ${transfer.cancel_reason}` : ''}</dd></>}
          {transfer.notes && <><dt>Note</dt><dd style={{ margin: 0 }}>{transfer.notes}</dd></>}
          {transfer.receive_note && <><dt>On arrival</dt><dd style={{ margin: 0 }}>{transfer.receive_note}</dd></>}
        </dl>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <caption style={{ textAlign: 'left', fontWeight: 700, color: navy, marginBottom: 6 }}>{t.items} item{t.items === 1 ? '' : 's'} · {t.sent} unit{t.sent === 1 ? '' : 's'} sent</caption>
          <thead><tr style={{ textAlign: 'left', color: gray500, fontSize: '11.5px' }}>
            <th scope='col' style={{ padding: '6px 4px', borderBottom: `1px solid ${border}` }}>Item</th>
            <th scope='col' style={{ padding: '6px 4px', borderBottom: `1px solid ${border}`, textAlign: 'right' }}>Sent</th>
            <th scope='col' style={{ padding: '6px 4px', borderBottom: `1px solid ${border}`, textAlign: 'right' }}>Received</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const short = l.qty_received != null && l.qty_received < l.qty_sent
              return (
                <tr key={l.id}>
                  <td style={{ padding: '8px 4px', borderBottom: `1px solid ${border}`, color: navy }}>{l.product_name}</td>
                  <td style={{ padding: '8px 4px', borderBottom: `1px solid ${border}`, textAlign: 'right' }}>{l.qty_sent}</td>
                  <td style={{ padding: '4px', borderBottom: `1px solid ${border}`, textAlign: 'right', color: short ? warning : navy }}>
                    {canReceive
                      ? <input type='number' min='0' max={l.qty_sent} value={received[l.id] ?? ''} placeholder={String(l.qty_sent)} aria-label={`Received of ${l.product_name}`}
                          onChange={(e) => setReceived((r) => ({ ...r, [l.id]: e.target.value }))}
                          style={{ width: 80, padding: '8px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, textAlign: 'right', fontSize: '13px' }} />
                      : l.qty_received == null ? '–' : `${l.qty_received}${short ? ` (${l.qty_sent - l.qty_received} short)` : ''}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {canReceive && (
          <>
            <div style={{ fontSize: '12px', color: gray600, background: bg, padding: '10px 12px', borderRadius: theme.radius.md }}>
              Count what arrived. Leave a quantity empty if it all arrived; enter the number you got if some is missing or damaged. The stock is added here when you confirm.
            </div>
            <Inp id='receive-note' label='Note (optional)' value={note} onChange={setNote} placeholder='e.g. One box damaged in transit' />
          </>
        )}
        {mayCancel && confirmCancel && (
          <>
            <div role='note' style={{ fontSize: '12.5px', color: danger }}>Cancelling returns every item to {locationName(byId(transfer.from_branch_id))}. The other location will not receive it.</div>
            <Inp id='cancel-reason' label='Reason (optional)' value={reason} onChange={setReason} placeholder='e.g. Sent to the wrong branch' />
          </>
        )}
        {t.shortfall > 0 && <div style={{ fontSize: '12.5px', color: warning, fontWeight: 600 }}>{t.shortfall} unit{t.shortfall === 1 ? '' : 's'} did not arrive.</div>}
        {error && <div role='alert' style={{ fontSize: '13px', color: danger }}>{error}</div>}
      </div>
    </Modal>
  )
}
