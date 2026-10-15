import {
  trendsByMonth, topReactionTerms, seriousnessBreakdown, outcomeCounts,
  byProductBrand, byBatchLot, suppressCounts, countBySource, countBy, SMALL_GROUP_THRESHOLD,
} from './analytics'
import { sourceBadge } from './pvWorkflow'
import { theme } from '../../styles/theme'
import { Card, Empty } from '../../components/ui'

// ── PV analytics section (Phase 6) ─────────────────────────────────────────
// Every figure carries its denominator, period, active filters and limits.
// Small groups are suppressed (privacy); sparse data gets an explicit state.
// Charts describe reports of suspected reactions — never causation.

const CRITERION_LABELS = {
  death: 'Death',
  life_threatening: 'Life-threatening',
  hospitalization: 'Hospitalisation',
  disability: 'Disability',
  congenital_anomaly: 'Congenital anomaly',
  other_medically_important: 'Other medically important',
}

const OUTCOME_LABELS = {
  recovered: 'Recovered',
  recovering: 'Recovering',
  not_recovered: 'Not recovered',
  recovered_with_sequelae: 'Recovered with sequelae',
  fatal: 'Fatal',
  unknown: 'Unknown',
}

function Caption({ n, periodLabel, activeFilters }) {
  // Single template expression: React SSR would otherwise inject <!-- -->
  // separators between text and values, breaking exact-match assertions.
  const line = `n = ${n} authorized cases · ${periodLabel} · Filters: ${activeFilters}`
  return (
    <p style={{ fontSize: 12, color: theme.textLight, margin: '0 0 8px' }}>
      {line}
    </p>
  )
}

function Section({ title, n, periodLabel, activeFilters, limitation, children }) {
  return (
    <Card style={{ padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: theme.textDark, marginBottom: 4 }}>{title}</div>
      <Caption n={n} periodLabel={periodLabel} activeFilters={activeFilters} />
      {children}
      {limitation && <p style={{ fontSize: 11.5, color: theme.textLight, marginTop: 6 }}>Limitation: {limitation}</p>}
    </Card>
  )
}

function BarRow({ label, count, total, drill, drillLabel }) {
  const pct = total > 0 && count !== null ? Math.round((count / total) * 100) : 0
  const inner = (
    <>
      <span style={{ fontSize: 12.5, fontWeight: 600, width: 170, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, width: 90 }}>
        {count === null ? 'suppressed for privacy' : `${count} · ${pct}%`}
      </span>
    </>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      {drill ? (
        <button type="button" onClick={drill} aria-label={`Drill into ${drillLabel || label}`}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left', flex: 1 }}>
          {inner}
        </button>
      ) : inner}
    </div>
  )
}

export default function PvAnalytics({ cases, periodLabel = 'Last 6 months', activeFilters = 'All', onDrill = () => {} }) {
  const n = cases.length
  const sparse = n < SMALL_GROUP_THRESHOLD
  const trends = trendsByMonth(cases, 6)
  const serious = seriousnessBreakdown(cases)
  const outcomes = outcomeCounts(cases)
  const terms = suppressCounts(topReactionTerms(cases, 10))
  const brands = suppressCounts(Object.entries(byProductBrand(cases)).sort((a, b) => b[1] - a[1]))
  const batches = suppressCounts(Object.entries(byBatchLot(cases)).sort((a, b) => b[1] - a[1]))
  const sources = countBySource(cases)
  const qualifications = countBy(cases.map((c) => ({ q: c.reporter_qualification })), 'q')

  return (
    <div>
      <Card style={{ padding: '12px 14px', marginBottom: 10 }}>
        <p style={{ fontSize: 13, color: theme.textDark, margin: 0 }}>
          These charts describe <strong>reports of suspected reactions</strong> in cases routed to your
          organisation. They do not establish that any product caused any outcome.
        </p>
        {sparse && (
          <p style={{ fontSize: 12.5, color: theme.textLight, margin: '6px 0 0' }} role="status">
            Limited data: {n} authorized cases — figures below are indicative. Small groups are
            suppressed for privacy until at least {SMALL_GROUP_THRESHOLD} cases accumulate.
          </p>
        )}
      </Card>

      <Section title="Reports over time" n={n} periodLabel={periodLabel} activeFilters={activeFilters}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 100 }} role="img"
          aria-label={`Monthly counts: ${trends.map(([m, c]) => `${m} ${c}`).join(', ')}`}>
          {trends.map(([m, c]) => (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{c}</div>
              <div style={{ width: '100%', maxWidth: 40, height: `${Math.max((c / Math.max(...trends.map(([, x]) => x), 1)) * 100, 3)}%`, background: '#0E6F5A', borderRadius: '4px 4px 0 0' }} />
              <div style={{ fontSize: 10, color: theme.textLight }}>{m.slice(2)}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Serious vs non-serious" n={n} periodLabel={periodLabel} activeFilters={activeFilters}
        limitation="Serious means any reaction flagged any of the six criteria.">
        <BarRow label={`Serious (${serious.anySerious} of ${n})`} count={serious.anySerious} total={n} />
        <BarRow label={`Non-serious (${n - serious.anySerious} of ${n})`} count={n - serious.anySerious} total={n} />
        {Object.entries(serious.criteria).map(([k, c]) => (
          <BarRow key={k} label={CRITERION_LABELS[k]} count={c} total={n} />
        ))}
      </Section>

      <Section title="Outcomes" n={n} periodLabel={periodLabel} activeFilters={activeFilters}
        limitation="Reaction-level outcomes; one case can contribute several.">
        {Object.entries(outcomes).map(([o, c]) => (
          <BarRow key={o} label={OUTCOME_LABELS[o]} count={c} total={n} />
        ))}
      </Section>

      <Section title="Most reported reactions" n={n} periodLabel={periodLabel} activeFilters={activeFilters}
        limitation="Free-text descriptions grouped case-insensitively; counts below threshold are withheld.">
        {terms.length === 0 && <Empty title="No reaction terms" description="Terms appear once routed cases include reaction descriptions." />}
        {terms.map((t) => (
          <BarRow key={t.label} label={t.label} count={t.count} total={n}
            drill={t.suppressed ? null : () => onDrill({ query: t.label })} drillLabel={t.label} />
        ))}
      </Section>

      <Section title="By product and batch" n={n} periodLabel={periodLabel} activeFilters={activeFilters}
        limitation="Case-level counts (one case, one vote per product/batch). Unlisted names group under Not recorded, never attributed.">
        {brands.map((b) => (
          <BarRow key={`brand-${b.label}`} label={b.label} count={b.count} total={n}
            drill={b.suppressed ? null : () => onDrill({ query: b.label === 'Not recorded' ? '' : b.label })} drillLabel={b.label} />
        ))}
        {batches.map((b) => (
          <BarRow key={`batch-${b.label}`} label={`Batch ${b.label}`} count={b.count} total={n} />
        ))}
      </Section>

      <Section title="By report source" n={n} periodLabel={periodLabel} activeFilters={activeFilters}
        limitation="Recorded submission channel only — never inferred.">
        {Object.entries(sources).map(([s, c]) => (
          <BarRow key={s} label={sourceBadge(s).label} count={c} total={n}
            drill={() => onDrill({ source: s })} drillLabel={sourceBadge(s).label} />
        ))}
      </Section>

      <Section title="By reporter type" n={n} periodLabel={periodLabel} activeFilters={activeFilters}
        limitation="Reporter qualification as recorded. Geographic breakdown is unavailable — location is not collected on safety reports, so none is estimated.">
        {Object.entries(qualifications).sort((a, b) => b[1] - a[1]).map(([q, c]) => (
          <BarRow key={q} label={q} count={c} total={n} />
        ))}
      </Section>
    </div>
  )
}
