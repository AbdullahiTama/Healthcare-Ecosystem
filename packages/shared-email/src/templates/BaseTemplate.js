const baseStyle = `
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  background: #f9fafb;
  padding: 20px;
`
const cardStyle = `
  background: white; border-radius: 16px; padding: 32px; border: 1px solid #f0f0f0; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
`
const btnStyle = `
  display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #0E6F5A, #0B5A49); color: white; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px; margin-top: 20px;
`
export function logoHeader(brand = 'CareHub') {
  const colors = { CareHub: '#0E6F5A', CareFind: '#0E6F5A', default: '#0E6F5A' }
  return `<div style="text-align:center;margin-bottom:24px"><div style="display:inline-flex;align-items:center;gap:10px"><div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${colors[brand]||'#0E6F5A'},#0B5A49);display:flex;align-items:center;justify-content:center;font-size:20px">🏥</div><span style="font-size:24px;font-weight:900;color:#0f172a">${brand}</span></div></div>`
}
export function footer(brand = 'CareHub', domain = 'carehub.ng') {
  return `<div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #f0f0f0;color:#aaa;font-size:12px"><p>${brand} — One Platform for Every Healthcare Business in Nigeria</p><p style="margin-top:4px">support@${domain} | ${domain}</p></div>`
}
export function baseStyle() { return baseStyle }
export function cardStyle() { return cardStyle }
export function btnStyle() { return btnStyle }
export function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
