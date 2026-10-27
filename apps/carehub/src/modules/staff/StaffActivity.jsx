import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, ShieldAlert } from 'lucide-react'
import { staffActivityRepository, ACTIVITY_LIMIT } from './repositories'
import { PERIODS, periodRange, filterActivity, summarisePeople, filterChoices, kindLabel, SENSITIVE, personKey } from './staffActivity'
import { fmt, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, Pill, Empty, ErrorState, Loading, Sel, Inp, Avatar } from '../../components/ui'

const { navy, gray400, gray500, gray600, gray100, border, tealDeep, danger, warning, warningBg } = theme
const PAGE = 100
const when = (v) => (v ? new Date(v).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

// The Owner's view of what each staff member did: sales, refunds, stock
// changes, expenses, attendance, field visits and shifts, newest first, with a
// per-person summary. Read-only. The data comes from staff_activity(), which
// the database refuses to anyone but the Owner, so this screen is not the only
// gate. Role and person filters let the Owner compare roles; clicking a person
// in the summary narrows the feed to them.
export default function StaffActivity({ brand }) {
  const [period, setPeriod] = useState('week')
  const [from, setFrom] = useState(todayDate())
  const [to, setTo] = useState(todayDate())
  const [filters, setFilters] = useState({ person: '', role: '', kind: '', query: '' })
  const [limit, setLimit] = useState(PAGE)

  const range = useMemo(() => periodRange(period, { from, to }), [period, from, to])
  const fromIso = range?.start.toISOString()
  const toIso = range?.end.toISOString()
  const q = useQuery({
    queryKey: ['staffActivity', brand?.id, fromIso, toIso],
    queryFn: () => staffActivityRepository.get(brand.id, fromIso, toIso),
    enabled: !!brand?.id && !!range,
    staleTime: 30_000,
  })

  const rows = q.data || []
  const view = useMemo(() => {
    const filtered = filterActivity(rows, filters)
    return { filtered, people: summarisePeople(rows), choices: filterChoices(rows) }
  }, [rows, filters])
  const set = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setLimit(PAGE) }
  const capped = rows.length >= ACTIVITY_LIMIT

  if (!range) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PeriodBar period={period} setPeriod={setPeriod} from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <Empty icon={<Activity size={40} strokeWidth={1.5} />} message='Choose a start and end date (the start must not be after the end, and the range is at most 366 days).' />
      </div>
    )
  }

  const denied = q.isError && /Only the Owner/i.test(String(q.error?.message))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PeriodBar period={period} setPeriod={setPeriod} from={from} to={to} setFrom={setFrom} setTo={setTo} />

      {q.isLoading ? <Loading text='Loading staff activity…' /> : denied ? (
        <ErrorState message='Only the business Owner can view staff activity.' />
      ) : q.isError ? (
        <ErrorState message={'Could not load staff activity: ' + String(q.error?.message || q.error).replace(/^Supabase error \(\d{3}\):\s*/, '')} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Empty icon={<Activity size={40} strokeWidth={1.5} />} message='No staff activity in this period.' />
      ) : (
        <>
          {capped && (
            <div role='status' style={{ display: 'flex', gap: 8, padding: 12, borderRadius: theme.radius.md, background: warningBg, color: warning, fontSize: 12.5, lineHeight: 1.5 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0 }} aria-hidden='true' />
              <span>Showing the latest {ACTIVITY_LIMIT.toLocaleString()} actions. Narrow the dates to see older ones.</span>
            </div>
          )}

          <section aria-label='Per person'>
            <div style={{ fontSize: 12, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>By person</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
              {view.people.map((p) => {
                const on = filters.person === p.key
                return (
                  <button key={p.key} onClick={() => set('person', on ? '' : p.key)} aria-pressed={on} aria-label={`${p.name}: ${p.total} actions`}
                    style={{ textAlign: 'left', background: 'white', border: `1px solid ${on ? tealDeep : border}`, borderRadius: theme.radius.md, padding: 12, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={p.name} size={34} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: navy }}>{p.name}</div>
                        <div style={{ fontSize: 11.5, color: gray500 }}>{p.role || 'Owner or unlinked'} · last {when(p.last)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: gray600, marginTop: 10 }}>
                      <span><strong style={{ color: navy }}>{p.total}</strong> actions</span>
                      {p.counts.sale > 0 && <span><strong style={{ color: navy }}>{p.counts.sale}</strong> sales · {fmt(p.salesValue)}</span>}
                      {p.counts.refund > 0 && <span style={{ color: danger }}><strong>{p.counts.refund}</strong> refunds · {fmt(p.refundValue)}</span>}
                      {p.sensitive > 0 && p.counts.refund === undefined && <span>{p.sensitive} to review</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <Card style={{ padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              <Sel label='Person' value={filters.person} onChange={(v) => set('person', v)} options={view.choices.people} placeholder='Everyone' />
              <Sel label='Role' value={filters.role} onChange={(v) => set('role', v)} options={view.choices.roles} placeholder='All roles' />
              <Sel label='Activity' value={filters.kind} onChange={(v) => set('kind', v)} options={view.choices.kinds} placeholder='All activity' />
              <Inp label='Search' value={filters.query} onChange={(v) => set('query', v)} placeholder='Receipt, customer, note…' />
            </div>
          </Card>

          <section aria-label='Activity feed'>
            <div style={{ fontSize: 12.5, color: gray500, marginBottom: 6 }} aria-live='polite'>
              {view.filtered.length === rows.length ? `${rows.length} actions` : `${view.filtered.length} of ${rows.length} actions`}
            </div>
            {view.filtered.length === 0 ? (
              <Empty icon={<Activity size={40} strokeWidth={1.5} />} message='No activity matches these filters.' cause='filtered' />
            ) : (
              <Card style={{ padding: 0 }}>
                {view.filtered.slice(0, limit).map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderTop: i ? `1px solid ${gray100}` : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: navy }}>{r.actor_name}</span>
                        {r.actor_role && <span style={{ fontSize: 11.5, color: gray500 }}>{r.actor_role}</span>}
                        <Pill label={kindLabel(r.kind)} type={SENSITIVE.has(r.kind) ? 'amber' : 'gray'} />
                      </div>
                      <div style={{ fontSize: 12.5, color: gray600, marginTop: 2, overflowWrap: 'anywhere' }}>{r.summary}</div>
                      <div style={{ fontSize: 11, color: gray400, marginTop: 2 }}>{when(r.occurred_at)}</div>
                    </div>
                    {r.amount != null && <div style={{ fontWeight: 800, fontSize: 13, color: r.kind === 'refund' ? danger : navy, whiteSpace: 'nowrap' }}>{r.kind === 'refund' ? '−' : ''}{fmt(Math.abs(r.amount))}</div>}
                  </div>
                ))}
              </Card>
            )}
            {view.filtered.length > limit && (
              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button onClick={() => setLimit((l) => l + PAGE)} style={{ padding: '8px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Show more ({view.filtered.length - limit} left)</button>
              </div>
            )}
          </section>
          <div style={{ fontSize: 11.5, color: gray400, display: 'flex', gap: 6, alignItems: 'center' }}>
            <ShieldAlert size={12} aria-hidden='true' /> Read-only. Expenses are matched to staff by the name recorded; activity with no staff match is the Owner&apos;s or an unlinked login.
          </div>
        </>
      )}
    </div>
  )
}

function PeriodBar({ period, setPeriod, from, to, setFrom, setTo }) {
  return (
    <div>
      <div role='group' aria-label='Period' style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {PERIODS.map(([p, label]) => {
          const on = period === p
          return (
            <button key={p} onClick={() => setPeriod(p)} aria-pressed={on}
              style={{ padding: '7px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealDeep : 'white', color: on ? 'white' : gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{label}</button>
          )
        })}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <Inp label='From' type='date' value={from} onChange={setFrom} style={{ minWidth: 150 }} />
          <Inp label='To' type='date' value={to} onChange={setTo} style={{ minWidth: 150 }} />
        </div>
      )}
    </div>
  )
}
