// "22 Oct, 10:00" in the app's locale. Shared by the activity pages.
export function fmtStamp(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
