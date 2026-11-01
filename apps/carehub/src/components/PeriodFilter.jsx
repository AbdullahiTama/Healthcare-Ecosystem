import { useId } from 'react'
import { CalendarRange } from 'lucide-react'
import { theme } from '../styles/theme'
import { todayDate } from '../lib/utils'
import { PERIOD_MODES, PRESETS, periodBounds, presetPeriod } from '../lib/datePeriods'

const { navy, gray500, gray600, border, tealDeep, tealMist } = theme

const control = {
  minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`,
  fontSize: 13, outline: 'none', color: navy, background: 'white', fontFamily: theme.fontFamily, boxSizing: 'border-box',
}
const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }

// A period picker: all time, a specific day, the week around a day, a month, a
// year or a custom range, plus one-tap presets. Controlled: `value` is a period
// ({ mode, date, month, year, from, to }, see lib/datePeriods) and onChange
// receives the next one. `years` lists the years offered (newest first).
export default function PeriodFilter({ value, onChange, years, label = 'Period' }) {
  const uid = useId()
  const today = todayDate()
  const p = value || { mode: 'all' }
  const bounds = periodBounds(p)
  const yearList = years?.length ? years : Array.from({ length: 6 }, (_, i) => String(Number(today.slice(0, 4)) - i))
  const set = (patch) => onChange({ ...p, ...patch })

  function changeMode(mode) {
    // Switching mode starts from today, so the new control is never empty.
    if (mode === 'day' || mode === 'week') onChange({ mode, date: p.date || today })
    else if (mode === 'month') onChange({ mode, month: p.month || today.slice(0, 7) })
    else if (mode === 'year') onChange({ mode, year: p.year || today.slice(0, 4) })
    else if (mode === 'range') onChange({ mode, from: bounds.from || today.slice(0, 7) + '-01', to: bounds.to || today })
    else onChange({ mode: 'all' })
  }

  const isPreset = (key) => {
    const b = periodBounds(presetPeriod(key, today))
    return b.from === bounds.from && b.to === bounds.to
  }

  return (
    <div role='group' aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <CalendarRange size={16} color={gray500} aria-hidden='true' />
        <label htmlFor={uid + '-mode'} style={srOnly}>{label}</label>
        <select id={uid + '-mode'} value={p.mode} onChange={(e) => changeMode(e.target.value)} style={control}>
          {PERIOD_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
        {(p.mode === 'day' || p.mode === 'week') && (<>
          <label htmlFor={uid + '-date'} style={srOnly}>{p.mode === 'week' ? 'Any day in the week' : 'Date'}</label>
          <input id={uid + '-date'} type='date' value={p.date || ''} max={today} onChange={(e) => set({ date: e.target.value })} style={control} />
        </>)}
        {p.mode === 'month' && (<>
          <label htmlFor={uid + '-month'} style={srOnly}>Month</label>
          <input id={uid + '-month'} type='month' value={p.month || ''} max={today.slice(0, 7)} onChange={(e) => set({ month: e.target.value })} style={control} />
        </>)}
        {p.mode === 'year' && (<>
          <label htmlFor={uid + '-year'} style={srOnly}>Year</label>
          <select id={uid + '-year'} value={p.year || ''} onChange={(e) => set({ year: e.target.value })} style={control}>
            {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </>)}
        {p.mode === 'range' && (<>
          <label htmlFor={uid + '-from'} style={{ fontSize: 12, color: gray600 }}>From</label>
          <input id={uid + '-from'} type='date' value={p.from || ''} onChange={(e) => set({ from: e.target.value })} style={control} />
          <label htmlFor={uid + '-to'} style={{ fontSize: 12, color: gray600 }}>to</label>
          <input id={uid + '-to'} type='date' value={p.to || ''} onChange={(e) => set({ to: e.target.value })} style={control} />
        </>)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map(([key, text]) => {
          const on = p.mode !== 'all' && isPreset(key)
          return (
            <button key={key} type='button' aria-pressed={on} onClick={() => onChange(presetPeriod(key, today))}
              style={{ padding: '5px 10px', minHeight: 30, borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealMist : 'white', color: on ? tealDeep : gray600, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {text}
            </button>
          )
        })}
      </div>
      <div aria-live='polite' style={{ fontSize: 12, color: gray500 }}>Showing: <strong style={{ color: navy }}>{bounds.label}</strong></div>
    </div>
  )
}
