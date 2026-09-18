import { theme } from '../../../styles/theme';
import Button from '@care-ecosystem/design-system/components/ui/Button';
import VerificationBadge from './VerificationBadge';

export default function BusinessDetails({ business, onEdit, onClose }) {
  const handleCall = () => {
    if (business.phone) {
      window.open(`tel:${business.phone}`, '_self');
    }
  };

  const handleDirections = () => {
    if (business.latitude && business.longitude) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`,
        '_blank'
      );
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: business.name,
        text: `${business.name} - ${business.address || ''}`,
        url: window.location.href,
      });
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.name}>{business.name}</h2>
          {business.category && (
            <span style={styles.category}>{business.category.name}</span>
          )}
        </div>
        <VerificationBadge status={business.verification_status} />
      </div>

      {/* Description */}
      {business.description && (
        <p style={styles.description}>{business.description}</p>
      )}

      {/* Location */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Location</h3>
        {business.address && (
          <div style={styles.infoRow}>
            <MapPinIcon />
            <span>{business.address}</span>
          </div>
        )}
        {business.city && (
          <div style={styles.infoRow}>
            <BuildingIcon />
            <span>{business.city}{business.state && `, ${business.state}`}</span>
          </div>
        )}
        {business.latitude && business.longitude && (
          <div style={styles.coordinates}>
            <span>Lat: {business.latitude}</span>
            <span>Lng: {business.longitude}</span>
          </div>
        )}
      </div>

      {/* Contact */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Contact Information</h3>
        {business.phone && (
          <div style={styles.infoRow}>
            <PhoneIcon />
            <span>{business.phone}</span>
          </div>
        )}
        {business.email && (
          <div style={styles.infoRow}>
            <MailIcon />
            <span>{business.email}</span>
          </div>
        )}
        {business.website && (
          <div style={styles.infoRow}>
            <GlobeIcon />
            <a href={business.website} target="_blank" rel="noopener noreferrer" style={styles.link}>
              {business.website}
            </a>
          </div>
        )}
        {business.whatsapp && (
          <div style={styles.infoRow}>
            <WhatsAppIcon />
            <span>{business.whatsapp}</span>
          </div>
        )}
        {business.contact_person && (
          <div style={styles.infoRow}>
            <UserIcon />
            <span>{business.contact_person}</span>
          </div>
        )}
      </div>

      {/* Additional Info */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Additional Information</h3>
        {business.business_type && (
          <div style={styles.infoRow}>
            <TagIcon />
            <span>Type: {business.business_type}</span>
          </div>
        )}
        {business.data_source && (
          <div style={styles.infoRow}>
            <DatabaseIcon />
            <span>Source: {business.data_source}</span>
          </div>
        )}
        {business.created_at && (
          <div style={styles.infoRow}>
            <CalendarIcon />
            <span>Added: {new Date(business.created_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        {business.phone && (
          <Button variant="primary" leftIcon={<PhoneIcon />} onClick={handleCall}>
            Call
          </Button>
        )}
        {business.latitude && business.longitude && (
          <Button variant="outline" leftIcon={<NavigationIcon />} onClick={handleDirections}>
            Directions
          </Button>
        )}
        <Button variant="ghost" leftIcon={<ShareIcon />} onClick={handleShare}>
          Share
        </Button>
        <Button variant="ghost" leftIcon={<EditIcon />} onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

// Icon Components
function MapPinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22V12h6v10" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gray400} strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function NavigationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  name: {
    fontSize: '20px',
    fontWeight: '700',
    color: theme.gray900,
    margin: '0 0 4px 0',
  },
  category: {
    display: 'inline-block',
    fontSize: '12px',
    color: theme.tealDeep,
    background: theme.tealMist || '#f0fdfa',
    padding: '4px 10px',
    borderRadius: '12px',
    fontWeight: '500',
  },
  description: {
    fontSize: '14px',
    color: theme.gray600,
    lineHeight: '1.6',
    margin: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
    paddingBottom: '8px',
    borderBottom: `1px solid ${theme.gray100}`,
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: theme.gray600,
  },
  coordinates: {
    display: 'flex',
    gap: '16px',
    fontSize: '12px',
    color: theme.gray500,
    fontFamily: 'monospace',
  },
  link: {
    color: theme.tealDeep,
    textDecoration: 'none',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    paddingTop: '16px',
    borderTop: `1px solid ${theme.gray200}`,
  },
};

export default BusinessDetails;
