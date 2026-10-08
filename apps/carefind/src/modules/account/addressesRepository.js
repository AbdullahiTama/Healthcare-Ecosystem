import { supabase } from '../../config/supabaseClient'

export function createAddressesRepository(client = supabase) {
  async function list(userId) {
    const { data, error } = await client
      .from('customer_addresses')
      .select('*')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  }

  async function get(id) {
    const { data, error } = await client
      .from('customer_addresses')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle()
    if (error) throw error
    return data || null
  }

  async function create({ user_id, label, street, city, state, postal_code, country, is_default }) {
    const { data, error } = await client
      .from('customer_addresses')
      .insert({
        user_id,
        label: label || 'Home',
        street,
        city,
        state,
        postal_code: postal_code || null,
        country: country || 'Nigeria',
        is_default: is_default ?? false,
      })
      .select()
      .single()
    if (error) {
      if (error.message && error.message.includes('Maximum 10')) throw new Error('Maximum 10 addresses reached. Delete one to add another.')
      throw error
    }
    return data
  }

  async function update(id, fields) {
    const { data, error } = await client
      .from('customer_addresses')
      .update(fields)
      .eq('id', id)
      .eq('is_deleted', false)
      .select()
      .single()
    if (error) throw error
    return data
  }

  async function remove(id) {
    const addr = await get(id)
    if (!addr) throw new Error('Address not found')
    const wasDefault = addr.is_default
    const userId = addr.user_id
    const { error } = await client
      .from('customer_addresses')
      .update({ is_deleted: true, is_default: false })
      .eq('id', id)
    if (error) throw error
    if (wasDefault) {
      const { data: remaining } = await client
        .from('customer_addresses')
        .select('id')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(1)
      if (remaining && remaining.length > 0) {
        await client.rpc('set_default_address', { p_address_id: remaining[0].id })
      }
    }
    return true
  }

  async function setDefault(id) {
    const { data, error } = await client.rpc('set_default_address', { p_address_id: id })
    if (error) throw error
    return data
  }

  return { list, get, create, update, remove, setDefault }
}

export const addressesRepository = createAddressesRepository()
