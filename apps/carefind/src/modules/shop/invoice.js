// The order invoice: a standalone HTML document the customer opens in a new tab, reads on a phone or prints.
//
// Every value from the order is escaped. The document is opened from a blob: URL, which runs with the app's own origin,
// so an unescaped product name (written by the vendor) or address could run script with the customer's session.

import { escapeHtmlAttribute as esc } from '../../lib/openGraph.js'
import { STATUS_CONFIG, formatOrderAddress, formatKobo as naira } from './orderConstants'

function deliveryLabel(order) {
  if (order.delivery_kobo > 0) return naira(order.delivery_kobo)
  if (order.status === 'delivery_quote_pending') return 'To be quoted'
  return order.delivery_preference === 'pickup' ? 'Pickup' : 'Free'
}

export function buildInvoiceHtml(order) {
  const ref = esc(order.order_ref || String(order.id).slice(0, 8).toUpperCase())
  const items = order.order_items || order.shop_order_items || []
  const lineTotal = (item) => item.line_total_kobo ?? item.quantity * item.unit_price_kobo
  const subtotal = order.subtotal_kobo ?? items.reduce((s, i) => s + lineTotal(i), 0)
  const address = formatOrderAddress(order)
  const status = STATUS_CONFIG[order.status]?.label || String(order.status || '').replace(/_/g, ' ')
  const paymentStatus = order.payment_status === 'paid' ? 'Paid' : order.payment_status === 'refunded' ? 'Refunded' : 'Not paid'

  const summaryRows = [
    ['Subtotal', naira(subtotal)],
    ['Fulfilment fee', naira(order.fulfilment_kobo)],
    ['Delivery', deliveryLabel(order)],
    ...(order.discount_kobo > 0 ? [['Discount', `−${naira(order.discount_kobo)}`]] : []),
  ]

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${ref} · CareFind</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2933; margin: 0 auto; padding: 32px; max-width: 800px; font-size: 14px; line-height: 1.5; }
  h1, h2, p { margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; padding-bottom: 20px; margin-bottom: 24px; border-bottom: 2px solid #0E6F5A; }
  .brand h1 { color: #0E6F5A; font-size: 24px; }
  .brand p { color: #52606d; font-size: 13px; }
  .meta { text-align: right; }
  .meta h2 { font-size: 20px; letter-spacing: 2px; color: #0E6F5A; margin-bottom: 4px; }
  .section { margin-bottom: 24px; }
  .section h3 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0E6F5A; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
  dt { color: #52606d; }
  dd { margin: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #e4e7eb; vertical-align: top; }
  th { background: #f5f7fa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #52606d; }
  .num { text-align: right; white-space: nowrap; }
  .product { overflow-wrap: anywhere; }
  .item-meta { display: none; }
  .summary { margin-left: auto; width: 100%; max-width: 360px; }
  .summary td { border: 0; padding: 6px 0; }
  .summary .total td { border-top: 2px solid #0E6F5A; padding-top: 10px; font-size: 18px; font-weight: 700; color: #0E6F5A; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e4e7eb; font-size: 12px; color: #52606d; }
  .footer p + p { margin-top: 4px; }
  .actions { margin-bottom: 20px; text-align: right; }
  .actions button { font: inherit; font-weight: 600; padding: 10px 18px; min-height: 44px; border-radius: 8px; border: 1px solid #0E6F5A; background: #0E6F5A; color: #fff; cursor: pointer; }
  @media (max-width: 600px) {
    body { padding: 16px; font-size: 13px; }
    .header { flex-direction: column; }
    .meta { text-align: left; }
    .actions { text-align: left; }
    .actions button { width: 100%; }
    /* the item table becomes one row per product: name, then "qty × price", with the line total on the right */
    .items thead, .items .col-qty, .items .col-price { display: none; }
    .items td { padding: 10px 0; }
    .items .item-meta { display: block; color: #52606d; font-size: 12px; margin-top: 2px; }
    .summary { max-width: none; }
  }
  @media print { body { padding: 0; } .actions { display: none; } }
</style>
</head>
<body>
  <div class="actions"><button type="button" onclick="window.print()">Print or save as PDF</button></div>

  <div class="header">
    <div class="brand">
      <h1>CareFind</h1>
      <p>Healthcare Marketplace</p>
    </div>
    <div class="meta">
      <h2>INVOICE</h2>
      <dl>
        <dt>Order</dt><dd>${ref}</dd>
        <dt>Date</dt><dd>${esc(new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</dd>
        <dt>Status</dt><dd>${esc(status)}</dd>
      </dl>
    </div>
  </div>

  <div class="section">
    <h3>Customer</h3>
    <dl>
      <dt>Name</dt><dd>${esc(order.customer_name || '—')}</dd>
      <dt>Email</dt><dd>${esc(order.delivery_email || '—')}</dd>
      <dt>Phone</dt><dd>${esc(order.delivery_phone || '—')}</dd>
      <dt>Address</dt><dd>${esc(address || '—')}</dd>
    </dl>
  </div>

  <div class="section">
    <h3>Items</h3>
    <table class="items">
      <thead><tr><th>Product</th><th class="num col-qty">Qty</th><th class="num col-price">Unit price</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${items.map((item) => `<tr>
          <td class="product">${esc(item.product_name)}<span class="item-meta">${esc(item.quantity)} × ${naira(item.unit_price_kobo)}</span></td>
          <td class="num col-qty">${esc(item.quantity)}</td>
          <td class="num col-price">${naira(item.unit_price_kobo)}</td>
          <td class="num">${naira(lineTotal(item))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <table class="summary">
      <tbody>
        ${summaryRows.map(([label, value]) => `<tr><td>${label}</td><td class="num">${esc(value)}</td></tr>`).join('')}
        <tr class="total"><td>Total</td><td class="num">${naira(order.total_kobo)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h3>Payment</h3>
    <dl>
      <dt>Status</dt><dd>${paymentStatus}</dd>
      ${order.paystack_reference ? `<dt>Paystack ref</dt><dd>${esc(order.paystack_reference)}</dd>` : ''}
    </dl>
  </div>

  <div class="footer">
    <p>Thank you for shopping with CareFind.</p>
    <p>For support, contact support@carefind.ng</p>
    <p>This is a computer-generated invoice. No signature required.</p>
  </div>
</body>
</html>`
}
