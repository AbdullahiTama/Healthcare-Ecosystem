// Shared HTML escaping for the document.write print templates (receipts,
// consultations, requisitions). User-entered text must never be injected
// raw into a printed page — a product, client or settings field containing
// markup would otherwise render as HTML.
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')