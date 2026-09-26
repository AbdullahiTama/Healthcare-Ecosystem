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

// Per-app brand identity for email headers. Logo images are served from each
// app's public assets; PNG is used (not SVG) for maximum email-client support.
export const APP_BRANDS = {
  CareFind: { logoUrl: 'https://carefind.app/logo-wordmark.png' },
  CareHub: { logoUrl: 'https://carefindhub.com/logo-wordmark.png' },
}

export function logoHeader(appName) {
  const brand = APP_BRANDS[appName] || APP_BRANDS.CareFind
  return `<div style="text-align:center;padding:24px 0 16px"><img src="${brand.logoUrl}" alt="${esc(appName)} logo" width="44" height="50" style="display:block;margin:0 auto;width:44px;height:50px;object-fit:contain;border:0;outline:none;text-decoration:none"/><h1 style="margin:10px 0 0;font-size:20px;font-weight:800;color:#0E6F5A;letter-spacing:-0.5px">${esc(appName)}</h1></div>`
}

export function footer(appName, domain) {
  return `<div style="text-align:center;padding:24px 0 16px;margin-top:24px;border-top:1px solid #e5e7eb"><p style="margin:0;font-size:12px;color:#aaa">&copy; ${new Date().getFullYear()} ${esc(appName)}. All rights reserved.</p><p style="margin:4px 0 0;font-size:12px;color:#aaa">${esc(domain)}</p></div>`
}
