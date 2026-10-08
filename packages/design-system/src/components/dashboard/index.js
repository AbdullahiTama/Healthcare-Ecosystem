// Dashboard primitives — the shared visual language for CareHub Business,
// CareHub Admin and CareFind Admin (docs/design/DASHBOARD_FOUNDATION.md).
//
// Re-exported from `components/ui` so both apps' existing barrels pick them up
// without an import-path change. Everything here composes the existing shared
// primitives (Card, Button, StatCard, Empty, ErrorState, Skeleton, Avatar) —
// nothing here replaces a component that already solves the problem.
export { DashboardShell, MAIN_CONTENT_ID } from './DashboardShell'
export { PageHeader } from '../layout/PageHeader'
export { MetricGrid } from './MetricGrid'
export { SectionCard } from './SectionCard'
export { ChartCard } from './ChartCard'
export { Sparkline } from './Sparkline'
export { BarList } from './BarList'
export { ActivityList } from './ActivityList'
export { SearchBar } from './SearchBar'
export { FilterBar } from './FilterBar'
export { QuickAction } from './QuickAction'
export { UserMenu } from './UserMenu'
