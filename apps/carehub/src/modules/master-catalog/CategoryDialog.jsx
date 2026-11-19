import { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Sel } from '../../components/ui'

export const USE_LIBRARY = '__library'

// Bulk category for the selected items (set_master_category). Either one standard category for all of them, or, for
// items linked to the CareHub library, the library's category. Only the standard category changes: what locations
// sell an item under, and its prescription status, stay as they are.
export default function CategoryDialog({ show, count, categories, libraryAvailable, busy, onApply, onClose }) {
  const [choice, setChoice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (show) { setChoice(''); setError('') } }, [show])

  const options = [
    ...(libraryAvailable ? [{ value: USE_LIBRARY, label: 'Use each item’s CareHub library category' }] : []),
    ...categories.map((c) => ({ value: c.code, label: c.label })),
  ]
  function apply() {
    if (!choice) { setError('Choose a category.'); return }
    onApply(choice === USE_LIBRARY ? null : choice)
  }

  return (
    <Modal show={show} onClose={onClose} title={`Set the category of ${count} item${count === 1 ? '' : 's'}`}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={apply} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Saving…' : 'Set category'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Sel id='mc-bulk-category' aria-label='Category' value={choice} onChange={(v) => { setChoice(v); setError('') }} options={options} placeholder='Choose a category' />
        <p style={{ margin: 0, fontSize: '12.5px', color: theme.gray600 }}>
          {choice === USE_LIBRARY
            ? 'Items not linked to the library, or whose library entry has no category, keep theirs.'
            : 'Prescription status does not change. Check it on items that need a stricter one.'}
        </p>
        {error && <div role='alert' style={{ fontSize: '13px', color: theme.danger }}>{error}</div>}
      </div>
    </Modal>
  )
}
