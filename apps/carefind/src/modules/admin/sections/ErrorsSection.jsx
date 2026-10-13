import { AlertTriangle } from 'lucide-react'
import { Empty } from '@care-ecosystem/design-system/components/ui'
import '../ui/admin.css'

// The error inbox has no server behind it: the admin function has no actions
// to list or resolve errors. The old screen called `list_errors` and
// `resolve_error`, failed, and could pass for an empty inbox. This section
// says so plainly and makes no request, so it must not import callAdminAuth
// or any query hook until the server grows those actions.
export default function ErrorsSection() {
  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Error Inbox</h1>
        </div>
      </header>
      <Empty
        icon={<AlertTriangle size={40} strokeWidth={1.5} />}
        title="The error inbox isn't connected yet"
        description="The server has no actions to list or resolve errors, so there is nothing to show here."
        cause="none"
      />
    </div>
  )
}
