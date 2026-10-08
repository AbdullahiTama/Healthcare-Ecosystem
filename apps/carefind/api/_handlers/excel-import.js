import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

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

  const { data: rawBody, error: bodyErr } = await new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve({ data: Buffer.concat(chunks), error: null }))
    req.on('error', (err) => resolve({ data: null, error: err }))
  })

  if (bodyErr || !rawBody) return res.status(400).json({ error: 'Failed to read request body' })

  try {
    const workbook = XLSX.read(rawBody, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

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
    return res.status(400).json({ error: 'Failed to parse Excel file: ' + err.message })
  }
}
