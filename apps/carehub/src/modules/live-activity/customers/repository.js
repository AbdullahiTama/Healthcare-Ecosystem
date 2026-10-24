import { sbFetch } from '../../../services/supabase'

// Customers are not stored: they are the places field visits named, grouped by the database
// (field_customers / field_customer_visits, draft carehub_20261027_directory_field_link). Both readers run under
// the caller's own row level security, so a rep gets customers only from visits they may read.

// Before the draft is applied the readers do not exist. That is the one failure the screens explain in plain words
// instead of offering a retry that cannot help.
function isMissingReader(e) {
  const text = String(e && e.message ? e.message : e)
  return /PGRST202|42883|Could not find the function|function .* does not exist/i.test(text)
}

function notAvailable() {
  const err = new Error('Customers are not available yet.')
  err.code = 'NOT_AVAILABLE'
  return err
}

export function createCustomerRepository({ request = sbFetch } = {}) {
  async function call(path, body) {
    try {
      const rows = await request(path, { method: 'POST', body: JSON.stringify(body) })
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      if (isMissingReader(e)) throw notAvailable()
      throw e
    }
  }

  return {
    // The team's customers (field managers), or one rep's own when staffId is given.
    list(businessId, { staffId = null } = {}) {
      return call('rpc/field_customers', { p_business_id: businessId, p_staff_id: staffId })
    },

    // One customer's visits, newest first, each with the orders raised from it.
    visits(businessId, key) {
      return call('rpc/field_customer_visits', { p_business_id: businessId, p_key: key })
    },
  }
}

export const customerRepository = createCustomerRepository()
