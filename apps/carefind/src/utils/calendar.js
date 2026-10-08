export function generateCalendarUrl(show) {
  const { title, scheduled_at, description, host_name } = show
  if (!scheduled_at) return null

  const start = new Date(scheduled_at)
  const end = new Date(start.getTime() + 60 * 60 * 1000) // 1 hour default

  const formatGCal = (date) => date.toISOString().replace(/-|:|\.\d+/g, '')
  const formatOther = (date) => {
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`
  }

  const titleEncoded = encodeURIComponent(title || 'CareFind Live')
  const descEncoded = encodeURIComponent(description || `Live show hosted by ${host_name || 'CareFind creator'}`)
  const locationEncoded = encodeURIComponent('CareFind Live')

  const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${titleEncoded}&dates=${formatGCal(start)}/${formatGCal(end)}&details=${descEncoded}&location=${locationEncoded}`

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareFind//EN',
    'BEGIN:VEVENT',
    `DTSTART:${formatOther(start)}`,
    `DTEND:${formatOther(end)}`,
    `SUMMARY:${title || 'CareFind Live'}`,
    `DESCRIPTION:${description || 'Live show on CareFind'}`,
    `LOCATION:CareFind Live`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n')

  return { gcalUrl, icsContent }
}

export function downloadIcs(icsContent, filename) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'event.ics'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
