import { createClient } from '@supabase/supabase-js'
import writeExcelFile from 'write-excel-file/node'

// Writes the business-directory export as a one-sheet .xlsx. (Was `xlsx`/SheetJS; see excel-import.js for why it was replaced.)

const DEFAULT_FIELDS = [
  'name', 'category', 'address', 'state', 'lga', 'city',
  'phone', 'email', 'website', 'verification_status', 'latitude', 'longitude',
]

const FIELD_LABELS = {
  name: 'Business Name',
  category: 'Category',
  subcategory: 'Subcategory',
  address: 'Address',
  state: 'State',
  lga: 'LGA',
  city: 'City',
  area: 'Area',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  whatsapp: 'WhatsApp',
  contact_person: 'Contact Person',
  latitude: 'Latitude',
  longitude: 'Longitude',
  verification_status: 'Verification Status',
  data_source: 'Data Source',
  distance: 'Distance (km)',
  created_at: 'Created At',
  updated_at: 'Updated At',
}

// Excel's maximum column width, in characters.
const MAX_COLUMN_WIDTH = 255

function valueFor(business, field) {
  let value
  if (field === 'category' && business.category) value = business.category.name || ''
  else if (field === 'subcategory' && business.subcategory) value = business.subcategory.name || ''
  else if (field === 'created_at' || field === 'updated_at') value = business[field] ? new Date(business[field]).toLocaleDateString() : ''
  else value = business[field] || ''
  // Numbers (coordinates, distance) stay numbers; anything that is not a plain cell value is written as text.
  return typeof value === 'number' || typeof value === 'string' ? value : String(value)
}

// The filename comes from the caller and goes into a response header: keep it to harmless characters.
const safeFilename = (name) => String(name || 'businesses').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'businesses'

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

  const { businesses, fields, filename } = req.body || {}
  if (!businesses || !Array.isArray(businesses)) {
    return res.status(400).json({ error: 'businesses array is required' })
  }

  const exportFields = fields && fields.length > 0 ? fields : DEFAULT_FIELDS
  const labels = exportFields.map((field) => FIELD_LABELS[field] || field)
  const body = businesses.map((business) => exportFields.map((field) => valueFor(business, field)))

  const columns = labels.map((label, index) => ({
    width: Math.min(MAX_COLUMN_WIDTH, body.reduce((widest, row) => Math.max(widest, String(row[index]).length), label.length) + 2),
  }))

  const sheetData = [
    labels.map((value) => ({ value, fontWeight: 'bold' })),
    ...body.map((row) => row.map((value) => ({ value }))),
  ]
  const excelBuffer = await writeExcelFile(sheetData, { sheet: 'Businesses', columns }).toBuffer()

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.xlsx"`)
  return res.status(200).send(Buffer.from(excelBuffer))
}
