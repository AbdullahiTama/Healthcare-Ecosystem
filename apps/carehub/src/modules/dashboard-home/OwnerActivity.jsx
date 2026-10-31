import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Truck, Banknote, Receipt, CreditCard, Landmark, RotateCcw, Pencil, Trash2, Scale, HandCoins, ArrowRight, CheckCircle,
} from 'lucide-react'
import { staffActivityRepository } from '../staff/repositories'
import { purchaseRepository } from '../purchases/repositories'
import { debtRepository } from '../debts/repositories'
import { businessPeriod } from '../../lib/businessDay'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { ActivityList, Empty, ErrorState, Loading, SectionCard } from '../../components/ui'
import {
  CATEGORIES, selectOwnerActivity, countByCategory, recordTarget, describeWhat, describeWhoWhen, toneOf, isNew,
  followUps, activityWindow,
} from './ownerActivity'

const { tealDeep, navy, gray400, gray500, gray600, border, warning, warningBg, success } = theme

const ICONS = {
  purchase: Truck, supplier_payment: Banknote, expense: Receipt, credit_sale: CreditCard, debt: Landmark,
  repayment: HandCoins, refund: RotateCcw, sale_edited: Pencil, sale_deleted: Trash2, shift_close: Scale,
}
const SHOWN = 6
const MORE = 25
const REFRESH_MS = 60_000
const seenKey = (bid) => 'carehub_owner_activity_seen_' + bid

// The Owner's "Business activity": what staff recorded that touches money
// (purchases, supplier payments, expenses, credit, debts, refunds, corrections,
// a till that did not balance) over the last seven days, plus what still needs
// paying or chasing. Each row names who did it and when, and opens the record.
// Owner only, like the feed it reads (staff_activity refuses everyone else).
export default function OwnerActivity({ brand, onOpenSale }) {
  const navigate = useNavigate()
  const [category, setCategory] = useState('all')
  const [expanded, setExpanded] = useState(false)
  // When the Owner last looked: rows after it are marked "New" on this visit.
  const [lastSeen] = useState(() => { try { return localStorage.getItem(seenKey(brand?.id)) } catch (e) { return null } })

  const days = activityWindow()
  const range = useMemo(() => businessPeriod('custom', days), [days.from, days.to])
  const feed = useQuery({
    queryKey: ['ownerActivity', brand?.id, days.from, days.to],
    queryFn: () => staffActivityRepository.get(brand.id, range.start.toISOString(), range.end.toISOString(), 500),
    enabled: !!brand?.id && !!range,
    staleTime: 30_000,
    refetchInterval: REFRESH_MS,
  })
  const owed = useQuery({
    queryKey: ['ownerFollowUps', brand?.id],
    queryFn: async () => {
      const [supplierBalances, debts] = await Promise.all([
        purchaseRepository.getSupplierBalances(brand.id),
        debtRepository.getOpen(brand.id),
      ])
      return followUps({ supplierBalances: supplierBalances || [], debts: debts || [] })
    },
    enabled: !!brand?.id,
    staleTime: 30_000,
    refetchInterval: REFRESH_MS * 5,
  })

  // Remember this visit once the feed has been shown.
  useEffect(() => {
    if (!feed.data || !brand?.id) return
    try { localStorage.setItem(seenKey(brand.id), new Date().toISOString()) } catch (e) {}
  }, [feed.data, brand?.id])

  const rows = feed.data || []
  const counts = useMemo(() => countByCategory(rows), [rows])
  const visible = useMemo(() => selectOwnerActivity(rows, { category }), [rows, category])
  const newCount = useMemo(() => selectOwnerActivity(rows).filter((r) => isNew(r, lastSeen)).length, [rows, lastSeen])
  const shown = visible.slice(0, expanded ? MORE : SHOWN)

  const open = (row) => {
    const t = recordTarget(row)
    if (!t) return
    if (t.sale) onOpenSale?.(t.sale)
    else navigate(t.path)
  }

  const chip = (on) => ({
    padding: '6px 12px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`,
    background: on ? tealDeep : 'white', color: on ? 'white' : gray600, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  })

  return (
    <SectionCard
      title='Business activity'
      actions={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {newCount > 0 && (
            <span style={{ padding: '3px 9px', borderRadius: theme.radius.full, background: tealDeep, color: 'white', fontSize: 11, fontWeight: 800 }}>
              {newCount} new
            </span>
          )}
          <button type='button' onClick={() => navigate('/dashboard/staff?tab=activity')}
            style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
            See all <ArrowRight size={11} />
          </button>
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FollowUps query={owed} navigate={navigate} />

        <div role='group' aria-label='Show activity for' style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {CATEGORIES.map(([key, label]) => (
            <button key={key} type='button' aria-pressed={category === key} onClick={() => { setCategory(key); setExpanded(false) }} style={chip(category === key)}>
              {label}{counts[key] ? ` (${counts[key]})` : ''}
            </button>
          ))}
        </div>

        {feed.isLoading ? <Loading text='Loading business activity…' /> : feed.isError ? (
          <ErrorState message={/Only the Owner/i.test(String(feed.error?.message)) ? 'Only the business Owner can see business activity.' : 'Business activity could not be loaded.'} onRetry={() => feed.refetch()} />
        ) : (
          <>
            <ActivityList
              label='Business activity, newest first'
              empty={<Empty icon={<CheckCircle />} cause='none'
                message={category === 'all' ? 'No purchases, expenses, credit, refunds or changes recorded in the last 7 days.' : 'Nothing of this kind in the last 7 days.'} />}
              items={shown.map((r, i) => {
                const Icon = ICONS[r.kind] || Receipt
                const fresh = isNew(r, lastSeen)
                return {
                  id: `${r.kind}-${r.ref || ''}-${r.occurred_at}-${i}`,
                  tone: toneOf(r),
                  icon: <Icon size={16} />,
                  title: describeWhat(r),
                  meta: describeWhoWhen(r),
                  value: r.amount != null && r.kind !== 'shift_close' ? fmt(r.amount)
                    : r.kind === 'shift_close' ? (Number(r.amount) < 0 ? 'Short ' : 'Over ') + fmt(Math.abs(Number(r.amount))) : null,
                  badge: fresh ? <span style={{ fontSize: 10.5, fontWeight: 800, color: tealDeep, border: `1px solid ${tealDeep}`, borderRadius: theme.radius.full, padding: '1px 7px' }}>New</span> : null,
                  onClick: recordTarget(r) ? () => open(r) : undefined,
                }
              })}
            />
            {visible.length > SHOWN && (
              <button type='button' onClick={() => setExpanded((x) => !x)}
                style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>
                {expanded ? 'Show fewer' : `Show ${Math.min(visible.length, MORE) - SHOWN} more`}
              </button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  )
}

// What still needs paying or chasing, highlighted above the feed.
function FollowUps({ query, navigate }) {
  if (query.isLoading) return null
  if (query.isError) {
    return <div role='status' style={{ fontSize: 12, color: gray500 }}>Supplier balances and overdue debts could not be loaded right now.</div>
  }
  const f = query.data
  const tiles = [
    f.suppliers.count > 0 && {
      key: 'suppliers', label: 'Owed to suppliers', amount: f.suppliers.amount,
      sub: `${f.suppliers.count} supplier${f.suppliers.count === 1 ? '' : 's'} · largest ${f.suppliers.top[0].supplier_name} ${fmt(f.suppliers.top[0].balance)}`,
      path: '/dashboard/purchases?view=suppliers',
    },
    f.overdueBills.count > 0 && {
      key: 'bills', label: 'Bills past due', amount: f.overdueBills.amount,
      sub: `${f.overdueBills.count} unpaid · oldest ${f.overdueBills.top[0].party_name}, due ${f.overdueBills.top[0].due_date}`,
      path: '/dashboard/debts',
    },
    f.overdueOwed.count > 0 && {
      key: 'owed', label: 'Owed to you, past due', amount: f.overdueOwed.amount,
      sub: `${f.overdueOwed.count} debt${f.overdueOwed.count === 1 ? '' : 's'} · oldest ${f.overdueOwed.top[0].party_name}, due ${f.overdueOwed.top[0].due_date}`,
      path: '/dashboard/debts',
    },
  ].filter(Boolean)

  if (!tiles.length) {
    return (
      <div role='status' style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: success, fontWeight: 600 }}>
        <CheckCircle size={14} aria-hidden='true' /> No supplier balances or overdue debts to follow up.
      </div>
    )
  }
  return (
    <div role='group' aria-label='Needs follow-up' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
      {tiles.map((t) => (
        <button key={t.key} type='button' onClick={() => navigate(t.path)}
          style={{ textAlign: 'left', padding: '12px 14px', borderRadius: theme.radius.md, border: `1px solid ${warning}`, background: warningBg, cursor: 'pointer', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: warning }}>{t.label}</span>
          <span style={{ display: 'block', fontSize: 19, fontWeight: 900, color: navy, marginTop: 2 }}>{fmt(t.amount)}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: gray400, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.sub}</span>
        </button>
      ))}
    </div>
  )
}
