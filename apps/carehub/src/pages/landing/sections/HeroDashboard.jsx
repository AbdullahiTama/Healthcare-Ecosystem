import { theme } from '../../../styles/theme'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { ProductFrame, MockCaption, MockLabel, MockRow } from '../components/ProductFrame'

// A composed product surface, not a screenshot.
//
// Every label, route name and card title below is lifted from the real
// DashboardHome.jsx / staff-management / store-ops screens. Only the
// transaction rows are illustrative, and the caption below says so — the
// previous hero's CSS-drawn "live" figures were invented with no basis at all.
//
// Nothing in here is a focusable control: these are divs, so a keyboard user
// cannot land on a fake button and a screen reader hears one coherent
// description of the surface instead of a dozen empty controls.
const STATS = [
  { label: "Today's sales", value: '₦428,900', delta: '+8.4%' },
  { label: 'Items sold', value: '137', delta: '+12.1%' },
  { label: 'New patients', value: '12', delta: '+5.0%' },
  { label: 'Appointments', value: '24', delta: '+18.2%' },
]

const RECENT = [
  { patient: 'Aisha Bello', item: 'Amoxicillin 500mg', time: '09:41', amount: '₦4,200' },
  { patient: 'Tunde Okafor', item: 'Paracetamol 1000mg', time: '09:36', amount: '₦1,800' },
  { patient: 'Ngozi Eze', item: 'Metformin 500mg', time: '09:28', amount: '₦6,500' },
  { patient: 'Ibrahim Musa', item: 'Vitamin D3 1000IU', time: '09:15', amount: '₦9,200' },
]

const LOW_STOCK = [
  { name: 'Amoxicillin 500mg', left: '12 left' },
  { name: 'Paracetamol 1000mg', left: '8 left' },
  { name: 'Metformin 500mg', left: '5 left' },
]

const DASHBOARD_NAV = ['Dashboard', 'Point of Sale', 'Store Operations', 'Customers', 'Staff']

const SPARK = [10, 14, 11, 18, 15, 22, 26]

export function HeroDashboard() {
  const { isMobile } = useBreakpoint()

  return (
    <div>
      <ProductFrame url="carehub.ng/dashboard" bodyStyle={{ padding: isMobile ? 10 : 16 }}>
        <div style={{ minWidth: 0 }}>
          <MockLabel>Sales overview</MockLabel>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {STATS.map((s) => (
              <div
                key={s.label}
                style={{
                  background: '#ffffff',
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  padding: '11px 12px',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: theme.gray600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 800,
                    color: theme.navy,
                    letterSpacing: '-0.01em',
                    margin: '4px 0 2px',
                  }}
                >
                  {s.value}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: theme.tealDeep }}>{s.delta}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.35fr) minmax(0, 1fr)',
              gap: 12,
            }}
          >
            <div>
              <MockLabel>Recent transactions</MockLabel>
              <div style={{ display: 'grid', gap: 7 }}>
                {RECENT.map((r) => (
                  <MockRow key={`${r.patient}-${r.time}`} style={{ padding: '8px 10px' }}>
                    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: theme.navy,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {r.patient}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: theme.gray600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {r.item}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.navy }}>{r.amount}</div>
                      <div style={{ fontSize: 10.5, color: theme.gray600 }}>{r.time}</div>
                    </div>
                  </MockRow>
                ))}
              </div>
            </div>

            <div>
              <MockLabel>Low stock alerts</MockLabel>
              <div style={{ display: 'grid', gap: 7, marginBottom: 12 }}>
                {LOW_STOCK.map((s) => (
                  <MockRow key={s.name} style={{ padding: '8px 10px' }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: theme.navy,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {s.name}
                    </div>
                    <div
                      style={{
                        marginLeft: 'auto',
                        flexShrink: 0,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: theme.amberText,
                        background: theme.warningBg,
                        borderRadius: theme.radius.full,
                        padding: '2px 8px',
                      }}
                    >
                      {s.left}
                    </div>
                  </MockRow>
                ))}
              </div>

              <MockLabel>Revenue trend</MockLabel>
              <div
                style={{
                  background: '#ffffff',
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  padding: '12px 12px 10px',
                }}
              >
                <svg
                  viewBox="0 0 120 36"
                  preserveAspectRatio="none"
                  width="100%"
                  height="36"
                  role="img"
                  aria-label="Illustrative rising revenue trend"
                >
                  <polyline
                    points={SPARK.map((v, i) => `${(i / (SPARK.length - 1)) * 120},${36 - v * 1.25}`).join(' ')}
                    fill="none"
                    stroke={theme.tealDeep}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginTop: 14,
              paddingTop: 12,
              borderTop: `1px solid ${theme.border}`,
            }}
          >
            {DASHBOARD_NAV.map((n, i) => (
              <span
                key={n}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: i === 0 ? theme.tealDeep : theme.gray600,
                  background: i === 0 ? theme.tealMist : '#ffffff',
                  border: `1px solid ${i === 0 ? theme.tealMist : theme.border}`,
                  borderRadius: theme.radius.full,
                  padding: '3px 10px',
                  whiteSpace: 'nowrap',
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      </ProductFrame>

      <MockCaption>
        Composed from CareHub&rsquo;s real dashboard. Figures shown are illustrative examples.
      </MockCaption>
    </div>
  )
}
