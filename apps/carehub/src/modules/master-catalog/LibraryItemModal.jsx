import { useEffect, useState } from 'react'
import { BadgeCheck, Clock } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Textarea } from '../../components/ui'
import LibrarySearch from '../product-library/LibrarySearch'
import { libraryLabel, libraryFacts } from '../product-library/libraryRules'
import { rxStatus } from './catalogueRules'

const { navy, gray500, gray600, tealDeep, tealMist, warning, danger } = theme

// One catalogue item and the CareHub library: see what it is linked to and unlink it, link it to a library item, or
// suggest it for the library when it is not there. A suggestion is reviewed by CareHub; the owner is told the outcome.
export default function LibraryItemModal({ item, busy, onLink, onUnlink, onSuggest, onClose }) {
  const [picked, setPicked] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { setPicked(null); setSuggesting(false); setNote('') }, [item?.id])
  if (!item) return null

  const lib = item.library
  const s = item.suggestion
  const pending = s?.status === 'pending'

  let footer = <GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>
  if (lib) footer = <><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn><GhostBtn onClick={() => onUnlink(item)} disabled={busy} style={{ flex: 1, padding: '12px', color: danger }}>{busy ? 'Unlinking…' : 'Unlink'}</GhostBtn></>
  else if (picked) footer = <><GhostBtn onClick={() => setPicked(null)} style={{ flex: 1, padding: '12px' }}>Back</GhostBtn><TealBtn onClick={() => onLink(item, picked)} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Linking…' : 'Link'}</TealBtn></>
  else if (suggesting) footer = <><GhostBtn onClick={() => setSuggesting(false)} style={{ flex: 1, padding: '12px' }}>Back</GhostBtn><TealBtn onClick={() => onSuggest(item, note)} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Sending…' : 'Send suggestion'}</TealBtn></>

  const box = (bg, color) => ({ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: bg, color, fontSize: '12.5px' })

  return (
    <Modal show onClose={onClose} title={`${item.name} and the CareHub library`} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {lib ? (
          <>
            <div role='note' style={box(tealMist, tealDeep)}>
              <BadgeCheck size={16} aria-hidden='true' style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Linked to <strong>{libraryLabel(lib)}</strong>{libraryFacts(lib) ? ` · ${libraryFacts(lib)}` : ''}</span>
            </div>
            <p style={{ margin: 0, fontSize: '12.5px', color: gray600 }}>
              Its prescription status can be no less strict than {rxStatus(lib.rx_status)?.label || 'the library’s'}. If CareHub makes it stricter, your item and every location follow.
              Unlinking keeps the item’s details and status as they are.
            </p>
          </>
        ) : picked ? (
          <div role='alertdialog' aria-label='Confirm link' style={{ fontSize: '13px', color: gray600, lineHeight: 1.6 }}>
            Link <strong>{item.name}</strong> to <strong>{libraryLabel(picked)}</strong>? Your name and prices stay. Empty details are filled in from the library
            {rxStatus(picked.rx_status) ? `, and the prescription status becomes at least ${rxStatus(picked.rx_status).label}` : ''}.
          </div>
        ) : suggesting ? (
          <>
            <p style={{ margin: 0, fontSize: '13px', color: gray600 }}>
              CareHub will review <strong>{item.name}</strong> with the details you have saved{item.generic_name || item.strength ? '' : ' (adding the generic name and strength first helps)'}. If it is added, your item is linked to it.
            </p>
            <Textarea id='suggest-note' label='Note for CareHub (optional)' value={note} onChange={setNote} placeholder='e.g. Made by Emzor, sold in packs of 10' maxLength={500} />
          </>
        ) : (
          <>
            {s && (
              <div role='status' style={box(pending ? theme.warningBg : theme.dangerBg, pending ? warning : danger)}>
                <Clock size={15} aria-hidden='true' style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{pending ? 'You suggested this item for the library. CareHub will review it.'
                  : s.status === 'rejected' ? `Your suggestion was not added${s.review_note ? `: ${s.review_note}` : '.'}` : ''}</span>
              </div>
            )}
            <LibrarySearch label='Find this item in the CareHub library' onPick={setPicked} />
            {!pending && (
              <div style={{ fontSize: '12.5px', color: gray500 }}>
                Not in the library? <button type='button' onClick={() => setSuggesting(true)}
                  style={{ background: 'none', border: 'none', padding: '8px 0', color: navy, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: '12.5px' }}>Suggest it</button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
