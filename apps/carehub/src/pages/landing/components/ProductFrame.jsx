import { theme } from '../../../styles/theme'

// Browser chrome around a composed product surface.
//
// The hero's primary visual is product, not photography, so it needs to read as
// a real application window rather than a floating card: traffic-light dots, an
// address pill in the mono stack the app already uses for reference strings.
// The URL shown is the real route the product is served from.
//
// data-mock-surface marks this as an illustration, not a live view. The
// accessibility test asserts the marker exists and that nothing focusable sits
// inside it, because a composed mockup must never put a keyboard user on a
// dead control.
export function ProductFrame({ url = 'carehub.ng/dashboard', children, style, bodyStyle }) {
  return (
    <div
      data-mock-surface
      style={{
        background: '#ffffff',
        border: `1px solid ${theme.border}`,
        borderRadius: 20,
        boxShadow: theme.elevation[3],
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          height: 40,
          background: theme.cardBg,
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 14px',
          flexShrink: 0,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: theme.gray300,
              flexShrink: 0,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: 8,
            fontFamily: theme.fontMono,
            fontSize: 11,
            fontWeight: 500,
            color: theme.gray600,
            background: '#ffffff',
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius.full,
            padding: '2px 10px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {url}
        </span>
      </div>
      <div style={{ background: 'var(--bg)', padding: 14, ...bodyStyle }}>{children}</div>
    </div>
  )
}

// Every control inside a composed product surface is a div, never a button —
// nothing illustrative may be reachable by keyboard or announced as actionable.
export function MockRow({ children, style }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 11px',
        background: '#ffffff',
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius.md,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function MockLabel({ children, style }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: theme.gray600,
        marginBottom: 9,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// The caption under every composed surface. The numbers in these frames are
// illustrative, and saying so on the page is cheaper than being accused of it.
export function MockCaption({ children }) {
  return (
    <p
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        color: theme.gray600,
        textAlign: 'center',
        margin: '12px 0 0',
      }}
    >
      {children}
    </p>
  )
}
