import { theme } from '../../../styles/theme';
import VerificationBadge from './VerificationBadge';

export default function BusinessCard({ business, onClick, showDistance, distance }) {
  const handleClick = () => {
    if (onClick) onClick(business);
  };

  const handleCall = (e) => {
    e.stopPropagation();
    if (business.phone) {
      window.open(`tel:${business.phone}`, '_self');
    }
  };

  const handleDirections = (e) => {
    e.stopPropagation();
    if (business.latitude && business.longitude) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`,
        '_blank'
      );
    }
  };

  const handleShare = (e) => {
    e.stopPropagation();
    if (navigator.share) {
      navigator.share({
        title: business.name,
        text: `${business.name} - ${business.address || ''}`,
        url: window.location.href,
      });
    }
  };

  return (
    <div style={styles.card} onClick={handleClick}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h3 style={styles.name}>{business.name}</h3>
          <VerificationBadge status={business.verification_status} size="sm" />
        </div>
        {business.category && (
          <span style={styles.category}>{business.category.name}</span>
        )}
      </div>

      {/* Address */}
      {business.address && (
        <div style={styles.addressRow}>
          <MapPinIcon />
          <span style={styles.address}>
            {business.address}
            {business.city && `, ${business.city}`}
            {business.state && `, ${business.state}`}
          </span>
        </div>
      )}

      {/* Distance */}
      {showDistance && distance && (
        <div style={styles.distanceRow}>
          <NavigationIcon />
          <span style={styles.distance}>{distance}</span>
        </div>
      )}

      {/* Contact */}
      <div style={styles.contactRow}>
        {business.phone && (
          <div style={styles.contactItem}>
            <PhoneIcon />
            <span>{business.phone}</span>
          </div>
        )}
        {business.email && (
          <div style={styles.contactItem}>
            <MailIcon />
            <span>{business.email}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        {business.phone && (
          <button style={styles.actionButton} onClick={handleCall} title="Call">
            <PhoneIcon />
          </button>
        )}
        {business.latitude && business.longitude && (
          <button style={styles.actionButton} onClick={handleDirections} title="Directions">
            <NavigationIcon />
          </button>
        )}
        <button style={styles.actionButton} onClick={handleShare} title="Share">
          <ShareIcon />
        </button>
      </div>
    </div>
  );
}

// Icon Components
function MapPinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function NavigationIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

const styles = {
  card: {
    background: 'white',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    padding: '16px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      borderColor: theme.tealDeep,
      boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
    },
  },
  header: {
    marginBottom: '12px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  name: {
    fontSize: '16px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
  },
  category: {
    fontSize: '12px',
    color: theme.gray500,
    background: theme.gray100,
    padding: '2px 8px',
    borderRadius: '12px',
  },
  addressRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    marginBottom: '8px',
  },
  address: {
    fontSize: '13px',
    color: theme.gray600,
    lineHeight: '1.4',
  },
  distanceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
  },
  distance: {
    fontSize: '13px',
    color: theme.tealDeep,
    fontWeight: '500',
  },
  contactRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '12px',
  },
  contactItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: theme.gray600,
  },
  actions: {
    display: 'flex',
    gap: '8px',
    paddingTop: '12px',
    borderTop: `1px solid ${theme.gray100}`,
  },
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    background: theme.gray50,
    border: 'none',
    borderRadius: theme.radius.sm,
    cursor: 'pointer',
    transition: 'all 0.2s',
    ':hover': {
      background: theme.tealMist || '#f0fdfa',
    },
  },
};

export default BusinessCard;
