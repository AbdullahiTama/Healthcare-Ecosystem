import { createClient } from '@supabase/supabase-js'
import { readFirstSheetRows, SpreadsheetError } from '../_lib/spreadsheet.js'

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

  // An import is a spreadsheet, not an upload. Without a ceiling the whole body is buffered with no bound, so a large
  // or slow POST exhausts memory. 5 MB is far above any real business-directory spreadsheet; anything bigger is a
  // mistake or an attack. The parser (api/_lib/spreadsheet.js, exceljs) also refuses an .xlsx whose zip contents would
  // expand past its own limit, so a small upload cannot inflate into gigabytes either.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

  const { data: rawBody, error: bodyErr } = await new Promise((resolve) => {
    const chunks = []
    let total = 0
    let rejected = false

    const bail = (data, error) => {
      if (!rejected) { rejected = true; resolve({ data, error }) }
    }

    req.on('data', (chunk) => {
      if (rejected) return
      total += chunk.length
      if (total > MAX_UPLOAD_BYTES) {
        bail(null, new Error('payload_too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => bail(Buffer.concat(chunks), null))
    req.on('error', (err) => bail(null, err))
  })

  if (bodyErr && bodyErr.message === 'payload_too_large') {
    return res.status(413).json({
      error: 'File too large',
      detail: `Maximum upload size is ${MAX_UPLOAD_BYTES} bytes`,
    })
  }

  if (bodyErr || !rawBody || rawBody.length === 0) return res.status(400).json({ error: 'Failed to read request body' })

  try {
    const jsonData = (await readFirstSheetRows(rawBody)).filter((row) => row.some((cell) => cell !== ''))

    if (jsonData.length < 2) {
      return res.status(400).json({ error: 'Excel file is empty or has no data rows' })
    }

    const headers = jsonData[0].map((h) => String(h).trim().toLowerCase())
    const records = []

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i]
      const record = {}
      headers.forEach((header, index) => {
        record[header] = row[index] ? String(row[index]).trim() : ''
      })
      records.push(record)
    }

    return res.status(200).json({ headers, records, totalRows: records.length })
  } catch (err) {
    if (err instanceof SpreadsheetError) {
      return res.status(err.code === 'too_large' ? 413 : 400).json({ error: err.message, code: err.code })
    }
    console.error('[excel-import] parse failed:', err)
    return res.status(400).json({ error: 'The file could not be read as an .xlsx spreadsheet.' })
  }
}
