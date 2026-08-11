import { theme } from '../../styles/theme'
import { Card } from '../ui'

// Shared shape for every desktop right-sidebar: a sticky column of labeled
// card sections. Extracted from RightSidebar.jsx (the feed's trending/news
// panel) so page-specific sidebars (BusinessProfile's contact card,
// DrugProfile's review-intelligence card) use the same visual language
// instead of re-implementing the sticky/width/section-header rules.
export function StickySidebar({ children, width = 320 }) {
  return (
    <aside
      style={{
        width, flexShrink: 0, position: 'sticky', top: 80,
        height: 'fit-content', maxHeight: 'calc(100vh - 96px)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}
    >
      {children}
    </aside>
  )
}

export function SidebarSection({ title, children }) {
  return (
    <Card style={{ padding: 16 }}>
      <p style={{ margin: '0 0 12px 0', fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </p>
      {children}
    </Card>
  )
}
