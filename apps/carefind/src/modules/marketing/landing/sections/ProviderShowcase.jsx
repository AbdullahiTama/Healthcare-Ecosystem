import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock, MapPin, MessageCircle, Phone, Pill as PillIcon } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { Stars, Pill } from '../../../../components/ui'
import { whatsappLink, telLink } from '../../../utils/marketplace.js'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import { Eyebrow } from '../components/LandingSection.jsx'
import { PROVIDER_SHOWCASE, ROUTES } from '../data/landingContent.js'

// The provider profile showcase — field-for-field what BusinessProfile.jsx
// actually renders: name, type and city, opening hours, distance, rating with a
// review count, about, services with duration and price, contact, booking and
// directions.
//
// Deliberately absent: any "verified" badge for the business. The chip in
// BusinessProfile.jsx is hard-coded and has no column behind it, so restating
// it here would put an unsupported claim on the most trust-sensitive part of
// the page. The claim angle is covered honestly in the Trust section instead.
//
// Contact links are built with the same whatsappLink/telLink helpers the real
// profile uses, so the deep-link behaviour (Nigerian number normalisation,
// prefilled message) is identical.

const p = PROVIDER_SHOWCASE.profile

function ContactButton({ href, icon: Icon, label, background, onClick }) {
  return (
    <a
      href={href}
      onClick={onClick}
      style={{
        flex: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        minHeight: 44,
        padding: '0 12px',
        background,
        color: '#fff',
        borderRadius: theme.radius.md,
        fontWeight: 700,
        fontSize: 13.5,
        textDecoration: 'none',
        boxSizing: 'border-box',
      }}
    >
      <Icon size={16} aria-hidden="true" />
      {label}
    </a>
  )
}

function ProfileCard() {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
        boxShadow: theme.elevation[1],
      }}
    >
      {/* Identity band */}
      <div style={{ padding: '20px 22px 18px', borderBottom: `1px solid ${theme.hairline}` }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div
            aria-hidden="true"
            style={{
              width: 52,
              height: 52,
              borderRadius: theme.radius.md,
              background: theme.navy,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {p.name[0]}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: theme.textDark,
                lineHeight: 1.25,
              }}
            >
              {p.name}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: theme.textMid, textTransform: 'capitalize' }}>
              {p.typeLabel} · {p.city}, {p.state}
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 16px',
            marginTop: 14,
            fontSize: 12.5,
            color: theme.textMid,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <MapPin size={13} color={theme.tealDeep} aria-hidden="true" />
            {p.distance}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Clock size={13} color={theme.gray400} aria-hidden="true" />
            {p.hours}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <Stars value={p.rating.avg} size={15} />
          <span style={{ fontSize: 13, fontWeight: 700, color: theme.textDark }}>{p.rating.avg}</span>
          <span style={{ fontSize: 12.5, color: theme.textMid }}>{p.rating.count} reviews</span>
        </div>
      </div>

      {/* About */}
      <div style={{ padding: '18px 22px' }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: theme.textMid }}>{p.about}</p>
      </div>

      {/* Services */}
      <div style={{ padding: '0 22px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.textLight, marginBottom: 10 }}>
          Services
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.services.map((service) => (
            <li
              key={service.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '6px 10px',
                minHeight: 40,
                padding: '8px 12px',
                background: theme.cardBg,
                border: `1px solid ${theme.hairline}`,
                borderRadius: theme.radius.md,
              }}
            >
              <PillIcon size={15} color={theme.tealDeep} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: theme.textDark }}>
                {service.name}
              </span>
              {service.duration && (
                <span style={{ fontSize: 11.5, color: theme.textLight, whiteSpace: 'nowrap' }}>
                  {service.duration} min
                </span>
              )}
              {service.price !== null && service.price !== undefined ? (
                <span style={{ fontSize: 13, fontWeight: 800, color: theme.tealDeep, whiteSpace: 'nowrap' }}>
                  ₦{service.price.toLocaleString()}
                </span>
              ) : (
                <Pill label="Ask" type="gray" style={{ fontSize: 10 }} />
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Actions — the same four the real profile offers */}
      <div style={{ padding: '16px 22px 20px', borderTop: `1px solid ${theme.hairline}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <ContactButton
            href={whatsappLink(p.whatsapp, `Hi, I found ${p.name} on CareFind.`)}
            icon={MessageCircle}
            label="WhatsApp"
            background="#25D366"
          />
          <ContactButton href={telLink(p.phone)} icon={Phone} label="Call" background={theme.tealDeep} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            to={ROUTES.discovery}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              minHeight: 44,
              padding: '0 12px',
              background: '#fff',
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius.md,
              color: theme.textDark,
              fontWeight: 700,
              fontSize: 13.5,
              textDecoration: 'none',
              boxSizing: 'border-box',
            }}
          >
            <MapPin size={15} aria-hidden="true" />
            Directions
          </Link>
          <Link
            to={ROUTES.discovery}
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              minHeight: 44,
              padding: '0 12px',
              background: p.bookingEnabled ? theme.navy : '#e2e8f0',
              color: p.bookingEnabled ? '#fff' : theme.textMid,
              borderRadius: theme.radius.md,
              fontWeight: 700,
              fontSize: 13.5,
              textDecoration: 'none',
              boxSizing: 'border-box',
            }}
          >
            Book appointment
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ProviderShowcase() {
  const { isMobileOrTablet } = useBreakpoint()

  return (
    <section
      data-section="provider"
      style={{
        background: theme.bg,
        padding: '72px 20px 80px',
        borderTop: `1px solid ${theme.hairline}`,
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'grid',
          // Stacks below laptop. Resolved with useBreakpoint rather than a CSS
          // media query so the page has one responsive mechanism, matching every
          // other section (docs/design/RESPONSIVENESS.md).
          gridTemplateColumns: isMobileOrTablet ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: isMobileOrTablet ? 32 : 48,
          alignItems: 'center',
        }}
      >
        <div data-reveal style={{ minWidth: 0 }}>
          <Eyebrow>{PROVIDER_SHOWCASE.eyebrow}</Eyebrow>
          <h2
            style={{
              fontFamily: theme.fontDisplay,
              fontWeight: 900,
              fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)',
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              color: theme.textDark,
              margin: 0,
              textWrap: 'balance',
            }}
          >
            {PROVIDER_SHOWCASE.title}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: theme.textMid, margin: '14px 0 0', maxWidth: 480 }}>
            {PROVIDER_SHOWCASE.body}
          </p>
          <ul style={{ listStyle: 'none', margin: '24px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Opening hours', 'Services & prices', 'Reviews', 'Contact & booking'].map((item) => (
              <li key={item}>
                <Pill label={item} type="teal" />
              </li>
            ))}
          </ul>
          <Link
            to={ROUTES.discovery}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 24,
              minHeight: 44,
              fontSize: 14,
              fontWeight: 700,
              color: theme.tealDeep,
              textDecoration: 'none',
            }}
          >
            Explore facilities
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <div data-reveal-product style={{ minWidth: 0 }}>
          <ProfileCard />
          <p style={{ margin: '12px 0 0', fontSize: 11.5, color: theme.textLight, lineHeight: 1.5 }}>
            Illustrative profile. Layout and fields match the real CareFind
            provider page.
          </p>
        </div>
      </div>
    </section>
  )
}
