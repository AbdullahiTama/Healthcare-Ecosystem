import BulkDeleteModal from '../../../components/BulkDeleteModal'

export const CLIENT_KEPT_REASONS = {
  sales: 'has sales',
  appointments: 'has appointments',
  consultations: 'has consultations',
  debts: 'has debts',
  requests: 'has customer requests',
  linked_records: 'is linked to other client records',
}
export const clientKeptText = (reasons) => (reasons || []).map((r) => CLIENT_KEPT_REASONS[r] || r).join(', ')

// Deleting the marked clients (delete_clients keeps clients with history and says why; the rest can be restored).
export default function ClientDeleteModal({ clients, onDelete, onRestore, onClose }) {
  return (
    <BulkDeleteModal noun='client' count={clients.length} names={clients.map((c) => c.full_name)}
      notes={[
        <>Clients with sales, appointments, consultations, debts or customer requests are <strong>kept</strong>, and you will see which and why.</>,
        <>You can <strong>restore</strong> deleted clients afterwards from Recently deleted.</>,
      ]}
      reasonText={clientKeptText} keptHeading='because their history must stay linked to them'
      describeRestore={(r) => (r.skipped_phone_taken > 0 ? `${r.skipped_phone_taken} skipped because their phone number is used by another client now.` : '')}
      onDelete={onDelete} onRestore={onRestore} onClose={onClose} />
  )
}
