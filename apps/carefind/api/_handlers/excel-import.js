import { createClient } from '@supabase/supabase-js'
import { readSheet } from 'read-excel-file/node'
import { extractUpload } from '../_lib/multipart.js'

// Parses the FIRST sheet of an uploaded .xlsx workbook into { headers, records, totalRows } for the business-directory import.
//
// This used the `xlsx` package (SheetJS 0.18.5). Its npm release has known prototype-pollution and ReDoS flaws and no fix on npm,
// and this endpoint parses a file uploaded by any signed-in user. read-excel-file is small, maintained and reads only .xlsx: a
// legacy .xls (or anything that is not a workbook) is refused with a clear message instead of being parsed.
// The browser uploads with FormData (multipart/form-data); extractUpload unwraps the file before it is parsed. Before this, the
// wrapper itself was parsed as text, so an Excel import returned the boundary line as the header row.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  // A platform that already buffered the body leaves nothing to read from the stream.
  const { data: rawBody, error: bodyErr } = Buffer.isBuffer(req.body)
    ? { data: req.body, error: null }
    : await new Promise((resolve) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => resolve({ data: Buffer.concat(chunks), error: null }))
      req.on('error', (err) => resolve({ data: null, error: err }))
    })

  if (bodyErr || !rawBody) return res.status(400).json({ error: 'Failed to read request body' })

  // The browser sends the file as multipart/form-data; unwrap it before parsing.
  const file = extractUpload(rawBody, req.headers['content-type'])
  if (!file) return res.status(400).json({ error: 'Failed to read the uploaded file' })

  try {
    const rows = await readSheet(file)

    if (rows.length < 2) {
      return res.status(400).json({ error: 'Excel file is empty or has no data rows' })
    }

    const headers = rows[0].map((h) => (h == null ? '' : String(h)).trim().toLowerCase())
    const records = []

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const record = {}
      headers.forEach((header, index) => {
        record[header] = row[index] ? String(row[index]).trim() : ''
      })
      records.push(record)
    }

    return res.status(200).json({ headers, records, totalRows: records.length })
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse Excel file: ' + err.message })
  }
}
