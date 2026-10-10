// The bytes of an uploaded file from a request body.
//
// The browser uploads with FormData, so the body is multipart/form-data: the file wrapped in boundary lines and a
// Content-Disposition header. Handing that wrapper to a spreadsheet parser reads it as text (the old xlsx package returned the
// boundary line as the header row; a strict .xlsx reader refuses it). Any other content type is treated as the file itself.
//
// Deliberately minimal: it returns the FIRST part, which is all the upload endpoints send, using only Buffer searches (no
// regex over the body), so a hostile body costs a linear scan and nothing more.
export function extractUpload(body, contentType = '') {
  if (!Buffer.isBuffer(body)) return null
  const match = /^multipart\/form-data\s*;.*\bboundary=(?:"([^"]+)"|([^\s;]+))/i.exec(String(contentType))
  if (!match) return body

  const boundary = match[1] || match[2]
  const opening = Buffer.from(`--${boundary}`)
  const start = body.indexOf(opening)
  if (start < 0) return null

  // The part's headers end at the first blank line.
  const headersEnd = body.indexOf('\r\n\r\n', start + opening.length)
  if (headersEnd < 0) return null
  const dataStart = headersEnd + 4

  // The part's bytes end at the CRLF before the next boundary line (the file itself may contain any bytes, including CRLF).
  const closing = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart)
  return body.subarray(dataStart, closing < 0 ? body.length : closing)
}
