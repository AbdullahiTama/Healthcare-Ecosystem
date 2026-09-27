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

  const { businesses, fields, filename } = req.body || {}
  if (!businesses || !Array.isArray(businesses)) {
    return res.status(400).json({ error: 'businesses array is required' })
  }

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

  const exportFields = fields && fields.length > 0 ? fields : DEFAULT_FIELDS

  const transformed = businesses.map((business) => {
    const row = {}
    for (const field of exportFields) {
      const label = FIELD_LABELS[field] || field
      if (field === 'category' && business.category) {
        row[label] = business.category.name || ''
      } else if (field === 'subcategory' && business.subcategory) {
        row[label] = business.subcategory.name || ''
      } else if (field === 'created_at' || field === 'updated_at') {
        row[label] = business[field] ? new Date(business[field]).toLocaleDateString() : ''
      } else {
        row[label] = business[field] || ''
      }
    }
    return row
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(transformed)

  const colWidths = Object.keys(transformed[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...transformed.map((row) => String(row[key] || '').length)) + 2,
  }))
  ws['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, ws, 'Businesses')

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename || 'businesses'}.xlsx"`)
  return res.status(200).send(Buffer.from(excelBuffer))
}
