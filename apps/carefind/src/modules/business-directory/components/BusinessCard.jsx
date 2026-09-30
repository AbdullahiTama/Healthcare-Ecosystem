import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Mail, Navigation, Phone, Share2 } from 'lucide-react';
import { theme } from '../../../styles/theme';
import { businessCoords } from '../../utils/marketplace.js';
import VerificationBadge from './VerificationBadge';

// A business_directory row for the radius-discovery list.
//
// Fixes carried in from the audit:
//   * Touch targets are 44px, not 32px (ACCESSIBILITY.md:32).
//   * The name is a real <Link>, so the row is reachable and operable from the
//     keyboard. It was a div with onClick and no role or tabIndex, which made
//     the primary action of the whole row mouse-only.
//   * Share sends the business's own profile URL. It previously sent
//     window.location.href, i.e. the discovery search page.
//   * Coordinates resolve through businessCoords(), which accepts either
//     latitude/longitude or lat/lng. The old direct property read silently
//     dropped Directions and distance whenever the writer used the other
//     naming convention — the same trap documented in utils/marketplace.js:39.
//   * The ':hover' keys in the old styles object were dead: an inline style
//     object is not a CSS-in-JS sheet, so the hover treatment never rendered.
//     Hover is now applied from React state.
//   * Icons come from lucide-react, the ecosystem standard, rather than five
//     inline SVGs.

const ACTION_SIZE = 44;

export default function BusinessCard({ business, showDistance, distance, compact = false }) {
  const [hovered, setHovered] = useState(false);
  const coords = businessCoords(business);
  const profileHref = `/business/${business.id}`;

  const handleShare = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}${profileHref}`;
    const shareData = {
      title: business.name,
      text: [business.name, business.address, business.city].filter(Boolean).join(', '),
      url,
    };
    // navigator.share is absent on desktop; fall back to the clipboard so the
    // button is never a silent no-op.
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
    } catch (err) {
      /* Clipboard blocked — the button simply does nothing rather than throwing. */
    }
  };

  const callHref = business.phone ? `tel:${business.phone}` : null;
  const directionsHref = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`
    : null;

  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        border: `1px solid ${hovered ? theme.tealDeep : theme.gray200}`,
        borderRadius: theme.radius.md,
        padding: compact ? '14px' : '16px',
        boxShadow: hovered ? theme.elevation[2] : theme.elevation[1],
        transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: business.category ? 4 : 0,
            flexWrap: 'wrap',
          }}
        >
          <BusinessName href={profileHref} name={business.name} />
          <VerificationBadge status={business.verification_status} size="sm" />
        </div>
        {business.category?.name && (
          <span
            style={{
              display: 'inline-block',
              fontSize: 12,
              color: theme.gray500,
              background: theme.gray100,
              padding: '2px 8px',
              borderRadius: theme.radius.full,
            }}
          >
            {business.category.name}
          </span>
        )}
      </div>

      {business.address && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
          <MapPin size={14} color={theme.gray400} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 13, color: theme.gray600, lineHeight: 1.4, minWidth: 0 }}>
            {business.address}
            {business.city && `, ${business.city}`}
            {business.state && `, ${business.state}`}
          </span>
        </div>
      )}

      {showDistance && distance && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Navigation size={14} color={theme.tealDeep} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: theme.tealDeep, fontWeight: 600 }}>{distance}</span>
        </div>
      )}

      {(business.phone || business.email) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, minHeight: ACTION_SIZE,
                fontSize: 13, color: theme.gray600, textDecoration: 'none',
              }}
            >
              <Phone size={14} color={theme.gray400} aria-hidden="true" style={{ flexShrink: 0 }} />
              {business.phone}
            </a>
          )}
          {business.email && (
            <a
              href={`mailto:${business.email}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, minHeight: ACTION_SIZE,
                fontSize: 13, color: theme.gray600, textDecoration: 'none', wordBreak: 'break-all',
              }}
            >
              <Mail size={14} color={theme.gray400} aria-hidden="true" style={{ flexShrink: 0 }} />
              {business.email}
            </a>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          paddingTop: 12,
          borderTop: `1px solid ${theme.gray100}`,
        }}
      >
        {callHref && (
          <ActionButton href={callHref} label={`Call ${business.name}`}>
            <Phone size={17} color={theme.navy} aria-hidden="true" />
          </ActionButton>
        )}
        {directionsHref && (
          <ActionButton href={directionsHref} label={`Directions to ${business.name}`} external>
            <Navigation size={17} color={theme.navy} aria-hidden="true" />
          </ActionButton>
        )}
        <ActionButton label={`Share ${business.name}`} onClick={handleShare}>
          <Share2 size={17} color={theme.navy} aria-hidden="true" />
        </ActionButton>
      </div>
    </article>
  );
}

// The row's primary action. A router <Link>, not a clickable div, so it is in
// the tab order, opens in a new context on middle-click, and navigates without
// tearing down the SPA shell.
function BusinessName({ href, name }) {
  return (
    <Link
      to={href}
      style={{
        fontSize: 16,
        fontWeight: 700,
        color: theme.gray900,
        textDecoration: 'none',
        minHeight: ACTION_SIZE,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {name}
    </Link>
  );
}

function ActionButton({ href, label, onClick, external, children }) {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    background: theme.gray50,
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.sm,
    cursor: 'pointer',
    flexShrink: 0,
  };

  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        style={style}
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-label={label} style={style}>
      {children}
    </button>
  );
}
