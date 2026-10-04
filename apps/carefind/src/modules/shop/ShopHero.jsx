import { theme } from '../../styles/theme'
import { TRUST_POINTS } from '../marketplace/trustPoints.js'

// The banner above the Shop tab: what the marketplace is, plus the three trust points. Layout (stacked on phones, copy +
// portrait + points on desktop) lives in global.css under .cf-shop-hero so it adapts without a JS breakpoint.
// The portrait is decorative — the heading already says everything the photo does — so it has empty alt text.
export default function ShopHero() {
  return (
    <div className="cf-shop-hero-wrap">
    <section aria-labelledby="shop-hero-title" className="cf-shop-hero">
      <div className="cf-shop-hero__copy">
        <p style={{ margin: '0 0 6px 0', fontSize: 11.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.tealDeep }}>
          Healthcare marketplace
        </p>
        <h2 id="shop-hero-title" style={{ margin: '0 0 8px 0', fontSize: 'clamp(22px, 3.4vw, 32px)', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.15, color: theme.navy }}>
          Find trusted health products near you
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: theme.textMid, maxWidth: 460 }}>
          Compare prices, check availability and buy from verified pharmacies and sellers on CareFind.
        </p>
      </div>

      <img
        className="cf-shop-hero__img"
        src="/images/login-pharmacist.jpg"
        srcSet="/images/login-pharmacist-sm.jpg 480w, /images/login-pharmacist.jpg 900w"
        sizes="(min-width: 1024px) 220px, 160px"
        alt=""
        width={220}
        height={176}
        loading="lazy"
        decoding="async"
      />

      <ul className="cf-shop-hero__points" aria-label="Why shop on CareFind">
        {TRUST_POINTS.map(({ Icon, title, text }) => (
          <li key={title} className="cf-shop-hero__point">
            <span aria-hidden="true" className="cf-shop-hero__icon">
              <Icon size={18} color={theme.tealDeep} strokeWidth={1.8} />
            </span>
            <span>
              <span className="cf-shop-hero__point-title">{title}</span>
              <span className="cf-shop-hero__point-text">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
    </div>
  )
}
