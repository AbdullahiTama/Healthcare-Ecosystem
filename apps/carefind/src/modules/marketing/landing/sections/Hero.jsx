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
//   * Copy column left, cards column bottom-right. The cards are bottom-aligned
//     on desktop so they float over the subject's body rather than her face.

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

function PreviewGroup({ variant, limit }) {
  return (
    <div style={{ minWidth: 0 }}>
      <FloatingPreviews variant={variant} limit={limit} />
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 11.5,
          lineHeight: 1.4,
          color: 'rgba(255,255,255,0.72)',
          textAlign: variant === 'stack' ? 'right' : 'left',
        }}
      >
        {PREVIEW.disclaimer}
      </p>
    </div>
  )
}

export default function Hero() {
  const { isMobileOrTablet } = useBreakpoint()
  const { photo } = HERO

  const scrim = isMobileOrTablet
    ? 'linear-gradient(180deg, rgba(6,32,26,0.74) 0%, rgba(6,32,26,0.64) 30%, rgba(6,32,26,0.88) 62%, rgba(6,32,26,0.97) 100%)'
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
          isMobileOrTablet
            ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
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
            objectPosition: isMobileOrTablet ? '50% 18%' : '50% 12%',
          }}
        />
      </picture>

      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, backgroundImage: scrim }}
      />

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
          padding: isMobileOrTablet ? '96px 20px 36px' : '104px 20px 36px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobileOrTablet ? 'minmax(0, 1fr)' : 'minmax(0, 1.04fr) minmax(0, 0.96fr)',
            gap: isMobileOrTablet ? 24 : 48,
            alignItems: 'center',
            flex: '1 1 auto',
            minHeight: 0,
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
                }}
              >
                {HERO.eyebrow}
              </div>
              <h1
                style={{
                  fontFamily: theme.fontDisplay,
                  fontWeight: 900,
                  fontSize: 'clamp(2.3rem, 5.2vw, 3.8rem)',
                  lineHeight: 1.07,
                  letterSpacing: '-0.03em',
                  color: '#fff',
                  margin: 0,
                  textWrap: 'balance',
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

          {!isMobileOrTablet && (
            <div style={{ minWidth: 0, alignSelf: 'end' }}>
              <PreviewGroup variant="stack" limit={3} />
            </div>
          )}
        </div>

        {isMobileOrTablet && (
          <div style={{ marginTop: 28 }}>
            <PreviewGroup variant="row" />
          </div>
        )}

        <FeatureStrip />
        <TrustStrip />
      </div>
    </section>
  )
}
