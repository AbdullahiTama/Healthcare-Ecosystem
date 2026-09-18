import { theme } from '../../../styles/theme';

const STATUS_CONFIG = {
  verified: {
    label: 'Verified',
    background: '#dcfce7',
    color: '#166534',
    icon: 'check',
  },
  pending: {
    label: 'Pending',
    background: '#fef3c7',
    color: '#92400e',
    icon: 'clock',
  },
  unverified: {
    label: 'Unverified',
    background: theme.gray100,
    color: theme.gray600,
    icon: 'question',
  },
  rejected: {
    label: 'Rejected',
    background: '#fee2e2',
    color: '#991b1b',
    icon: 'x',
  },
};

export default function VerificationBadge({ status = 'unverified', size = 'md' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unverified;

  const sizeStyles = {
    sm: {
      padding: '2px 6px',
      fontSize: '10px',
      gap: '4px',
    },
    md: {
      padding: '4px 8px',
      fontSize: '12px',
      gap: '4px',
    },
    lg: {
      padding: '6px 12px',
      fontSize: '14px',
      gap: '6px',
    },
  };

  const iconSizes = {
    sm: 10,
    md: 12,
    lg: 14,
  };

  return (
    <span
      style={{
        ...styles.badge,
        ...sizeStyles[size],
        background: config.background,
        color: config.color,
      }}
    >
      <StatusIcon name={config.icon} size={iconSizes[size]} />
      {config.label}
    </span>
  );
}

function StatusIcon({ name, size }) {
  const icons = {
    check: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    clock: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    question: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    x: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  };

  return icons[name] || null;
}

const styles = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '12px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
};
