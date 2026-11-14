import ExportFormatModal from '../../../components/ExportFormatModal'

// Choosing the export format (docs/architecture/Purchases-Import-Export.md).
// `scope` describes what will be exported (the list's filters); `onExport(format)`
// does the work and resolves when done, so the dialog can show progress.
export default function PurchaseExportModal({ show, onClose, scope, onExport }) {
  return (
    <ExportFormatModal show={show} onClose={onClose} onExport={onExport} title='Export purchases' name='purchase-export-format'
      description={`Exports ${scope}, one row per item, in the same columns as the upload template (so a corrected file can be uploaded again). Includes costs, so the export is recorded in the audit log.`} />
  )
}
