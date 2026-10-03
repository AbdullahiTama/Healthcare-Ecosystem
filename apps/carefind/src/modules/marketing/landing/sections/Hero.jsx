import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import { useBreakpoint } from '../../../../hooks/useBreakpoint'
import FloatingPreviews from './FloatingPreviews.jsx'
import FeatureStrip from './FeatureStrip.jsx'
import TrustStrip from './TrustStrip.jsx'
import { HERO, PREVIEW } from '../data/landingContent.js'

// The photographic hero.
//
// An image-led hero: the headline and the one primary action on the left
// (bottom-stacked on phones), the floating ecosystem cards on the right, and
// the feature + capability strips closing the first viewport.
//
// The photo is portrait artwork (a pharmacist checking her phone), so it is
// docked to the right ~58% of the hero from laptop up and faded into the dark
// teal surface on its left edge with a mask — stretching a portrait image
// edge to edge would crop it to a thin band across her chest. On phones the
// portrait fits the portrait viewport and fills the section.
//
// Structure:
//   * <picture> sits behind the content; a brand-teal gradient on the section
//     is the fallback surface if the photo ever fails to load.
//   * Two gradient scrims guarantee white-text contrast: a vertical one
//     everywhere (heaviest at the bottom, where the strips live) and — from
//     laptop up — a horizontal one that darkens the text column.
//   * Copy left, photo right, and the preview cards in a row beneath the copy
//     so they never sit over her face.

const ACCENT = '#5FD8B5'

function Headline() {
  const { title, accent } = HERO
  const at = accent ? title.indexOf(accent) : -1
  if (at === -1) return <>{title}</>
  return (
    <>
      {title.slice(0, at)}
      <span style={{ color: ACCENT }}>{accent}</span>
      {title.slice(at + accent.length)}
    </>
  )
}

function scrollToSection(id) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

function HeroActions() {
  const onSecondary = (event) => {
    event.preventDefault()
    scrollToSection(HERO.secondary.anchor)
  }

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
      <Link
        to={HERO.primary.to}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 50,
          padding: '0 26px',
          borderRadius: theme.radius.full,
          background: '#fff',
          color: theme.tealDeep,
          fontWeight: 800,
          fontSize: 15,
          textDecoration: 'none',
          boxShadow: '0 10px 26px rgba(7, 32, 26, 0.35)',
        }}
      >
        {HERO.primary.label}
        <ArrowRight size={17} aria-hidden="true" />
      </Link>
      <a
        href={`#${HERO.secondary.anchor}`}
        onClick={onSecondary}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 50,
          padding: '0 24px',
          borderRadius: theme.radius.full,
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.45)',
          color: '#fff',
          fontWeight: 700,
          fontSize: 15,
          textDecoration: 'none',
        }}
      >
        {HERO.secondary.label}
      </a>
    </div>
  )
}

const DISCLAIMER_STYLE = {
  margin: '8px 0 0',
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'rgba(255,255,255,0.72)',
  textAlign: 'left',
}

// Pinned to the right edge at chin level, beside the subject. Scaled from its
// bottom-right corner and tilted in perspective so it reads as floating. The
// top offsets approximate where the photo's chin lands (phone: image is
// 120vw tall; desktop: docked panel anchored to the top of the hero).
function FloatingStack({ phone }) {
  const scale = phone ? 0.46 : 0.74
  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 2,
        right: phone ? -6 : 'max(24px, 2vw)',
        top: phone ? '47vw' : 392,
        pointerEvents: 'none',
      }}
    >
      <div style={{ width: 300 * scale }}>
        <div
          style={{
            width: 300,
            transformOrigin: 'top left',
            transform: `perspective(900px) rotateY(-9deg) scale(${scale})`,
          }}
        >
          <FloatingPreviews limit={3} />
        </div>
      </div>
    </div>
  )
}

export default function Hero() {
  const { isMobile } = useBreakpoint()
  const { photo } = HERO

  // Phones: the whole portrait sits above the copy (120vw tall) and fades into
  // the dark surface, the headline overlaps her torso, the cards float beside
  // her. Tablet and desktop dock the photo on the right instead.
  const scrim = isMobile
    ? 'linear-gradient(180deg, rgba(6,32,26,0.20) 0%, rgba(6,32,26,0.10) 30vw, rgba(6,32,26,0.78) 74vw, rgba(6,32,26,0.96) 112vw, rgba(6,32,26,0.98) 100%)'
    : [
        'linear-gradient(90deg, rgba(6,32,26,0.93) 0%, rgba(6,32,26,0.78) 42%, rgba(6,32,26,0.22) 70%, rgba(6,32,26,0.30) 100%)',
        'linear-gradient(180deg, rgba(6,32,26,0.30) 0%, rgba(6,32,26,0.05) 34%, rgba(6,32,26,0.55) 74%, rgba(6,32,26,0.96) 100%)',
      ].join(', ')

  return (
    <section
      data-section="hero"
      style={{
        position: 'relative',
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        // Fallback surface behind the photo: if the image 404s or is still
        // loading, the hero still reads as a branded dark panel.
        background: `linear-gradient(155deg, ${theme.tealDeep} 0%, ${theme.navy} 70%)`,
        color: '#fff',
      }}
    >
      <picture
        style={
          isMobile
            ? {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '120vw',
                WebkitMaskImage: 'linear-gradient(180deg, #000 70%, transparent 100%)',
                maskImage: 'linear-gradient(180deg, #000 70%, transparent 100%)',
              }
            : {
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: '58%',
                // Dissolve the photo's left edge into the dark surface so there
                // is no hard seam where the portrait starts.
                WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)',
                maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)',
              }
        }
      >
        <source media="(max-width: 767px)" srcSet={photo.mobile} />
        <img
          src={photo.desktop}
          alt={photo.alt}
          width={1145}
          height={1374}
          loading="eager"
          decoding="async"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            // Keep her face in frame: the portrait is cropped to the section's
            // aspect ratio, and the subject's head sits in the top third.
            objectPosition: isMobile ? '50% 0%' : '50% 12%',
          }}
        />
      </picture>

      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, backgroundImage: scrim }}
      />

      <FloatingStack phone={isMobile} />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          boxSizing: 'border-box',
          padding: isMobile ? '54vw 20px 36px' : '104px 20px 36px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: isMobile ? 24 : 48,
            alignItems: 'center',
            flex: '1 1 auto',
            // Desktop: keep the strips below the floating cards, which end
            // ~660px down the hero whatever the viewport height.
            minHeight: isMobile ? 0 : 540,
          }}
        >
          <div style={{ minWidth: 0, maxWidth: 560, alignSelf: 'center' }}>
            <div data-hero>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.85)',
                  marginBottom: 14,
                  // Phones: leave the right ~38% free for the floating cards.
                  maxWidth: isMobile ? '62%' : undefined,
                }}
              >
                {HERO.eyebrow}
              </div>
              <h1
                style={{
                  fontFamily: theme.fontDisplay,
                  fontWeight: 900,
                  fontSize: isMobile ? 'clamp(1.9rem, 8vw, 2.1rem)' : 'clamp(2.3rem, 5.2vw, 3.8rem)',
                  lineHeight: 1.07,
                  letterSpacing: '-0.03em',
                  color: '#fff',
                  margin: 0,
                  textWrap: 'balance',
                  maxWidth: isMobile ? '62%' : undefined,
                }}
              >
                <Headline />
              </h1>
              <p
                style={{
                  fontSize: 16,
                  lineHeight: 1.7,
                  color: 'rgba(255,255,255,0.86)',
                  margin: '18px 0 0',
                  maxWidth: 480,
                }}
              >
                {HERO.body}
              </p>
            </div>

            <div data-hero>
              <HeroActions />
            </div>
          </div>

        </div>

        {/* The cards float beside the subject (FloatingStack); the disclaimer
            stays in flow underneath the copy. */}
        <p style={{ ...DISCLAIMER_STYLE, marginTop: 16 }}>{PREVIEW.disclaimer}</p>

        <FeatureStrip />
        <TrustStrip />
      </div>
    </section>
  )
}
