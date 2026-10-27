import { Layers, RefreshCw, Archive, RotateCcw, Building2 } from 'lucide-react'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, Pill, GhostBtn, TealBtn } from '../../components/ui'
import { rxStatus, carryingByLocation, carryingSummary, locationName } from './catalogueRules'

const { tealDeep, tealMist, navy, gray500, gray600, border, warning } = theme

// One master item: its facts, prescription status, and where it is carried (price and stock per location). The
// checkbox selects it for bulk actions. Wraps to a single column on a phone.
export default function MasterItemCard({ item, locations, categoryLabel, upgraded, selected, onSelect, onEdit, onLocations, onPush, onArchive, onRestore }) {
  const rows = carryingByLocation(item, locations)
  const rx = rxStatus(item.rx_status)
  const archived = !!item.archived_at
  const facts = [item.generic_name, item.strength, item.dose_form, item.pack_size].filter(Boolean).join(' · ')
  const checkboxId = `select-${item.id}`

  return (
    <Card style={{ padding: '16px', opacity: archived ? 0.75 : 1 }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {!archived && (
          <input id={checkboxId} type='checkbox' checked={selected} onChange={(e) => onSelect(item.id, e.target.checked)}
            aria-label={`Select ${item.name}`} style={{ width: 18, height: 18, marginTop: 4, accentColor: tealDeep, cursor: 'pointer', flexShrink: 0 }} />
        )}
        <div aria-hidden='true' style={{ width: 40, height: 40, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Layers size={20} />
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', color: navy, overflowWrap: 'anywhere' }}>{item.name}</span>
            {categoryLabel && <Pill label={categoryLabel} type='teal' />}
            {upgraded && rx && <Pill label={rx.label} type={rx.pill} />}
            {archived && <Pill label='Archived' type='gray' />}
          </div>
          {facts && <div style={{ fontSize: '12px', color: gray600, marginTop: '3px' }}>{facts}</div>}
          <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap', fontSize: '12px' }}>
            <span style={{ color: tealDeep, fontWeight: 700 }}>Default {fmt(item.default_price)}</span>
            {item.barcode && <span style={{ color: gray500 }}>Barcode {item.barcode}</span>}
            {upgraded && <span style={{ color: gray500, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building2 size={12} aria-hidden='true' /> {carryingSummary(rows)}</span>}
          </div>
          {upgraded && rows.some((r) => r.carried || r.stopped) && (
            <ul aria-label={`Locations carrying ${item.name}`} style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {rows.filter((r) => r.carried || r.stopped).map((r) => (
                <li key={r.location.id} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 999, border: `1px solid ${r.stopped ? border : tealMist}`, background: r.stopped ? 'white' : tealMist, color: r.stopped ? gray500 : tealDeep, fontWeight: 600 }}>
                  {locationName(r.location)} · {r.stopped ? 'stopped' : `${fmt(r.price)}${r.ownPrice ? ' (own price)' : ''} · ${r.stock} in stock`}
                  {r.products > 1 && <span style={{ color: warning }}> · {r.products} entries</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {archived ? (
            <GhostBtn onClick={() => onRestore(item)} aria-label={`Restore ${item.name}`}><RotateCcw size={13} aria-hidden='true' style={{ marginRight: 4 }} /> Restore</GhostBtn>
          ) : (
            <>
              <GhostBtn onClick={() => onLocations(item)} aria-label={`Locations and prices for ${item.name}`}>Locations</GhostBtn>
              <TealBtn onClick={() => onPush(item)} aria-label={`Push ${item.name} to every location`} style={{ padding: '8px 14px', fontSize: '12px' }}>
                <RefreshCw size={13} aria-hidden='true' style={{ marginRight: 5 }} /> Push
              </TealBtn>
              <GhostBtn onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`}>Edit</GhostBtn>
              <GhostBtn onClick={() => onArchive([item])} aria-label={`Archive ${item.name}`}><Archive size={13} aria-hidden='true' /></GhostBtn>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
