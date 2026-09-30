export { Button } from './Button'
export { Card } from './Card'
export { Pill, Badge } from './Pill'
export { StatusBadge } from './StatusBadge'
export { Avatar } from './Avatar'
export { Loading, Skeleton, CardSkeleton, Empty, ErrorState } from './State'
export { Input, Select, Textarea, Toggle, Label, HelperText, ErrorMessage } from './Form'
export { Modal } from './Modal'
export { ConfirmDialog } from './ConfirmDialog'
export { Toast } from './Toast'
export { useBreakpoint } from './useBreakpoint'
export { DataTable } from './DataTable'
export { StatCard } from './StatCard'

// Dashboard primitives (components/dashboard/*) — see DASHBOARD_FOUNDATION.md.
// PageHeader is re-exported here too: it is the dashboard's header (top utility
// bar in `compact` mode, page header otherwise), so there is no second header.
export { DashboardShell, MAIN_CONTENT_ID, MetricGrid, SectionCard, ChartCard, Sparkline, BarList, ActivityList, SearchBar, FilterBar, QuickAction, UserMenu } from '../dashboard'
export { PageHeader } from '../layout/PageHeader'
