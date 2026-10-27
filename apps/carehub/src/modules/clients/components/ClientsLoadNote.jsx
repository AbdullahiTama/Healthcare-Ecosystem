import { theme } from '../../../styles/theme'

// Shown under a client picker when the shared client list (useClients) could
// not be loaded. Picking a saved client is a convenience — a name can still be
// typed — so this is a note with a retry, not a blocking error. It replaces a
// silent `.catch(() => {})` that made the picker look like there were no clients.
export default function ClientsLoadNote({ query }) {
  if (!query?.isError) return null
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: theme.warning, fontWeight: 600 }}>
      <span>Saved clients couldn't be loaded. You can still type a name.</span>
      <button type="button" onClick={() => query.refetch()} style={{ background: 'none', border: 'none', padding: 0, color: theme.tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', minHeight: 24 }}>
        Try again
      </button>
    </div>
  )
}
