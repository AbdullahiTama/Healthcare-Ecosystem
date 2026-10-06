import { Lock, SearchX } from 'lucide-react'
import { Empty } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'

export function NoAccess() {
  return (
    <Empty
      icon={<Lock size={40} strokeWidth={1.5} color={theme.gray300} />}
      title="You don't have access to this screen"
      description="Ask a super admin to grant this screen to your role."
    />
  )
}

export function AdminNotFound() {
  return (
    <Empty
      icon={<SearchX size={40} strokeWidth={1.5} color={theme.gray300} />}
      title="This admin page does not exist"
      description="Pick a screen from the sidebar."
    />
  )
}
