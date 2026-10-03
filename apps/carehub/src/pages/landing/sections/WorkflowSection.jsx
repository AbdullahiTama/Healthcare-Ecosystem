import { theme } from '../../../styles/theme'
import { Section } from '../components/Section'
import { SectionHead } from '../components/SectionHead'
import { WORKFLOW } from '../data/workflow'

export function WorkflowSection() {
  return (
    <Section id="workflow" labelledBy="workflow-heading" surface="bg">
      <SectionHead
        id="workflow-heading"
        eyebrow="How it works"
        title="Three steps, then it is just daily work"
        lead="No implementation project, no consultant. Setup is a business type and a payment plan; everything after that is the work you were already doing."
      />

      <div data-reveal-group>
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            gap: 16,
            counterReset: 'step',
          }}
        >
          {WORKFLOW.map((w, i) => (
            <li
              key={w.title}
              data-reveal
              style={{
                position: 'relative',
                background: 'var(--bg)',
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radius.xl,
                padding: '26px 22px',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  background: theme.tealDeep,
                  color: '#ffffff',
                  fontSize: 15,
                  fontWeight: 800,
                  marginBottom: 18,
                }}
              >
                {i + 1}
              </span>

              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: theme.navy,
                  letterSpacing: '-0.01em',
                  margin: '0 0 10px',
                }}
              >
                {w.title}
              </h3>
              <p
                style={{
                  fontSize: 14.5,
                  fontWeight: 500,
                  lineHeight: 1.65,
                  color: theme.gray600,
                  margin: 0,
                }}
              >
                {w.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  )
}
