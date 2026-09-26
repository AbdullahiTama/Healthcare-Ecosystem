import { theme } from '../../theme'

// Unified Avatar (Stage 3 / 3.9). `src`: a real profile photo, when one
// exists — falls back to an initial on a colored background otherwise. Every
// avatar in the product should use this, not a hand-built circle.
export function Avatar({ name, size = 32, bg = theme.tealDeep, src, style = {} }) {
  if (src) {
    return (
      <div style={{ width: size, height: size, borderRadius: theme.radius.full, backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center', flexShrink: 0, ...style }} role="img" aria-label={name || 'Profile photo'} />
    )
  }
  return (
    <div style={{ width: size, height: size, borderRadius: theme.radius.full, background: bg, color: 'white', fontWeight: 900, fontSize: size * 0.38, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...style }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
}

export default Avatar
