import { Calendar, FlaskConical, ScanLine, HeartPulse, Activity, Stethoscope } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Section } from '../components/Section'
import { SectionHead } from '../components/SectionHead'
import { ProductFrame, MockCaption, MockLabel, MockRow } from '../components/ProductFrame'

// The real healthcare chain, as the product implements it.
//
// The module list and their order are taken from lib/permissions.js and the
// navigation: reception -> triage -> consultation -> lab -> imaging. The old
// page's healthcare section was a six-icon grid with a sentence of body copy;
// this shows the actual chain with a mock patient record beside it.
const CHAIN = [
  { icon: HeartPulse, label: 'Reception', note: 'Patient registers' },
  { icon: Activity, label: 'Triage', note: 'Vitals and priority' },
  { icon: Stethoscope, label: 'Consultation', note: 'Notes and diagnosis' },
  { icon: FlaskConical, label: 'Laboratory', note: 'Requests and results' },
  { icon: ScanLine, label: 'Imaging', note: 'Studies and reports' },
]

const APPOINTMENTS = [
  { time: '09:00', name: 'Aisha Bello', note: 'Follow-up · Dr Okonkwo' },
  { time: '09:30', name: 'Tunde Okafor', note: 'New patient · Dr Bello' },
  { time: '10:00', name: 'Ngozi Eze', note: 'Lab results · Dr Okonkwo' },
]

const PATIENT = [
  { label: 'Patient', value: 'Aisha Bello' },
  { label: 'Age', value: '34' },
  { label: 'Last visit', value: '12 Aug 2026' },
  { label: 'Outstanding', value: '₦0' },
]

export function ProductShowcase() {
  return (
    <Section id="product" labelledBy="product-heading" surface="bg">
      <SectionHead
        id="product-heading"
        eyebrow="One connected workspace"
        title="From the counter to the consultation room"
        lead="CareHub is a single system, not a bundle of disconnected tools. The sale, the patient, the stock and the money all land in the same place, so nothing has to be retyped between departments."
      />

      <div data-reveal-group>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
            gap: 12,
            marginBottom: 14,
          }}
        >
          {CHAIN.map((s, i) => (
            <div
              key={s.label}
              data-reveal
              style={{
                background: '#ffffff',
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radius.lg,
                padding: '18px 16px',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 34,
                  height: 34,
                  borderRadius: theme.radius.md,
                  background: theme.tealMist,
                  color: theme.tealDeep,
                  marginBottom: 12,
                }}
              >
                <s.icon size={17} />
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: theme.gray600,
                  marginBottom: 3,
                }}
              >
                STEP {i + 1}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>
                {s.label}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: theme.gray600, lineHeight: 1.5 }}>
                {s.note}
              </div>
            </div>
          ))}
        </div>

        <div
          data-reveal
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
            gap: 20,
            marginTop: 40,
          }}
        >
          <div>
            <ProductFrame url="carehub.ng/appointments" bodyStyle={{ padding: 16 }}>
              <MockLabel>Today&rsquo;s appointments</MockLabel>
              <div style={{ display: 'grid', gap: 8 }}>
                {APPOINTMENTS.map((a) => (
                  <MockRow key={a.time}>
                    <div
                      style={{
                        fontFamily: theme.fontMono,
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: theme.tealDeep,
                        flexShrink: 0,
                      }}
                    >
                      {a.time}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: theme.navy,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {a.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: theme.gray600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {a.note}
                      </div>
                    </div>
                    <Calendar
                      size={14}
                      style={{ marginLeft: 'auto', flexShrink: 0, color: theme.gray600 }}
                    />
                  </MockRow>
                ))}
              </div>
            </ProductFrame>
          </div>

          <div>
            <ProductFrame url="carehub.ng/patients/aisha-bello" bodyStyle={{ padding: 16 }}>
              <MockLabel>Patient record</MockLabel>
              <div
                style={{
                  background: '#ffffff',
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 14,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${theme.border}`,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      background: theme.tealMist,
                      color: theme.tealDeep,
                      fontSize: 13,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    AB
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: theme.navy }}>Aisha Bello</div>
                    <div style={{ fontSize: 11.5, color: theme.gray600 }}>MRN 004281</div>
                  </div>
                </div>

                <dl style={{ margin: 0, display: 'grid', gap: 9 }}>
                  {PATIENT.map((p) => (
                    <div
                      key={p.label}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                    >
                      <dt style={{ fontSize: 12, fontWeight: 600, color: theme.gray600 }}>{p.label}</dt>
                      <dd
                        style={{
                          margin: 0,
                          fontSize: 12,
                          fontWeight: 700,
                          color: theme.navy,
                          textAlign: 'right',
                        }}
                      >
                        {p.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </ProductFrame>
          </div>
        </div>

        <MockCaption>Composed from CareHub&rsquo;s healthcare workflow. Records shown are examples.</MockCaption>
      </div>
    </Section>
  )
}
