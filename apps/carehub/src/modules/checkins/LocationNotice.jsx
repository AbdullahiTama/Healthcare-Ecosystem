import { useState, useId } from 'react'
import { LOCATION_RETENTION_MONTHS } from './locationPolicy'
import { theme } from '../../styles/theme'

const { navy, gray600, tealDeep } = theme

const SUMMARY = {
  checkin: 'Your position is captured only when you press Check in or Check out.',
  report: 'Your position is captured once, when you open this form. It is not tracked afterwards.',
}

// A plain statement, where it matters, of when a position is taken and what happens to it. Every line is true
// of the app as built: position is requested only from a button or from opening the report form, never watched.
// The retention line says only what the company has actually set (see locationPolicy.js).
//   context          'checkin' | 'report'
//   retentionMonths  defaults to the company setting
export default function LocationNotice({ context, retentionMonths = LOCATION_RETENTION_MONTHS }) {
  const [open, setOpen] = useState(false)
  const panelId = 'location-notice-' + useId().replace(/:/g, '')
  const retention = Number.isFinite(retentionMonths) && retentionMonths > 0
    ? 'Positions on reports are kept for ' + retentionMonths + ' months, then removed.'
    : 'Your company decides how long positions are kept.'
  return (
    <div style={{ fontSize: '12px', color: gray600, margin: '6px 0 10px' }}>
      <span>{SUMMARY[context] || 'Your position is captured only when you ask.'}</span>{' '}
      <button type='button' aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', padding: 0, color: tealDeep, fontWeight: 700, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>
        How is my location used?
      </button>
      {open && (
        <ul id={panelId} style={{ margin: '6px 0 0', paddingLeft: '18px', color: navy, lineHeight: 1.5 }}>
          <li>What is captured: latitude, longitude, how accurate the fix was, and the time.</li>
          <li>When: only when you press a check-in button or open the report form. Never in the background, and never between those moments.</li>
          <li>Who sees it: the company owner and your managers. A colleague sees a report's position only if it was shared with them. Each time a manager looks at check-in positions, that is logged.</li>
          <li>{retention}</li>
          <li>Your records: you can see your own reports and check-ins. If one looks wrong, ask your company owner about it.</li>
        </ul>
      )}
    </div>
  )
}
