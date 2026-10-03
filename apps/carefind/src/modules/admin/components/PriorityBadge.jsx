import { theme } from '../../../styles/theme'

const PRIORITY_CONFIG = {
  urgent: { color: theme.danger, bg: theme.dangerBg, label: 'Urgent' },
  high: { color: '#b45309', bg: theme.warningBg, label: 'High' },
  medium: { color: theme.info, bg: theme.infoBg, label: 'Medium' },
  low: { color: theme.gray500, bg: theme.gray100, label: 'Low' },
};

export default function PriorityBadge({ priority, score }) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.low;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: theme.radius.full,
        fontSize: theme.type.caption.size,
        fontWeight: 700,
        color: config.color,
        background: config.bg,
        lineHeight: 1.4,
      }}
    >
      {config.label}
      {score != null && (
        <span style={{ opacity: 0.7, fontSize: 10 }}>
          {score}
        </span>
      )}
    </span>
  );
}
