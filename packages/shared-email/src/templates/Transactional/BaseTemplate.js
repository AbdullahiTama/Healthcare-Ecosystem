export function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function baseStyle() {
  return 'margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
}

export function cardStyle() {
  return 'background:#ffffff;border-radius:16px;padding:32px;margin:0 auto;max-width:560px;'
}

export function btnStyle() {
  return 'display:inline-block;background:#0E6F5A;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;padding:14px 32px;margin:8px 0;'
}

export function logoHeader(appName) {
  const color = appName === 'CareFind' ? '#0E6F5A' : '#0E6F5A'
  return `<div style="text-align:center;padding:24px 0 16px"><h1 style="margin:0;font-size:22px;font-weight:800;color:${color};letter-spacing:-0.5px">${esc(appName)}</h1></div>`
}

export function footer(appName, domain) {
  return `<div style="text-align:center;padding:24px 0 16px;margin-top:24px;border-top:1px solid #e5e7eb"><p style="margin:0;font-size:12px;color:#aaa">&copy; ${new Date().getFullYear()} ${esc(appName)}. All rights reserved.</p><p style="margin:4px 0 0;font-size:12px;color:#aaa">${esc(domain)}</p></div>`
}
