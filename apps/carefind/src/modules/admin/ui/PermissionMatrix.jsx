import { useId } from 'react'
import { NAV_GROUPS } from '../navigation'
import './admin.css'

// "Which sections may this role open": one checkbox per assignable section,
// grouped as in the navigation. The dashboard is always included, so it is a
// fixed note, not a checkbox. Items with no switch of their own (they follow
// another item's) are not listed. `value` is the role's tabs object; onChange
// receives a new object, `value` is never mutated, and keys this grid does not
// know about are kept. When `disabled`, the enabled sections are also listed as
// text for a read-only view.
export default function PermissionMatrix({ value, onChange, disabled = false, label = 'Permitted sections' }) {
  const prefix = useId()
  const tabs = value || {}
  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => i.key !== 'overview' && !i.permissionKey) }))
    .filter(g => g.items.length > 0)
  const enabled = groups.flatMap(g => g.items).filter(i => tabs[i.key] === true)

  return (
    <fieldset className="adm-matrix" disabled={disabled}>
      <legend className="adm-matrix-legend">{label}</legend>
      <p className="adm-matrix-note">Dashboard — always included</p>
      <div className="adm-matrix-groups">
        {groups.map(g => (
          <div className="adm-matrix-group" role="group" aria-labelledby={`${prefix}-${g.id}`} key={g.id}>
            <p className="adm-matrix-heading" id={`${prefix}-${g.id}`}>{g.label}</p>
            {g.items.map(i => (
              <label className="adm-matrix-item" key={i.key}>
                <input
                  type="checkbox"
                  checked={tabs[i.key] === true}
                  disabled={disabled}
                  onChange={() => onChange({ ...tabs, [i.key]: tabs[i.key] !== true })}
                />
                <span>{i.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {disabled && (
        <p className="adm-matrix-summary">{enabled.length ? `Switched on: ${enabled.map(i => i.label).join(', ')}` : 'Dashboard only'}</p>
      )}
    </fieldset>
  )
}
