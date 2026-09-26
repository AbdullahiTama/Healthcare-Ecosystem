import { supabase } from '../../../config/supabaseClient'

export function createSubscriptionRepository({ client = supabase } = {}) {
  return {
    async getWalletBalance(userId) {
      const { data, error } = await client
        .from('wallets')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data?.balance || 0
    },

    async ensureWallet(userId) {
      const { data, error } = await client
        .from('wallets')
        .insert({ user_id: userId, balance: 0 })
        .select()
        .single()
      if (error) throw error
      return data
    },

    async getProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error) throw error
      return data
    },

    async getSubscription(professionalId) {
      const { data, error } = await client
        .from('subscriptions')
        .select('*')
        .eq('professional_id', professionalId)
        .maybeSingle()
      if (error) throw error
      return data
    },

    async getActiveSubscribers(professionalId) {
      const { data, error } = await client
        .from('user_subscriptions')
        .select('id, subscriber_id, started_at, status, profiles(full_name, display_name)')
        .eq('professional_id', professionalId)
        .eq('status', 'active')
      if (error) throw error
      return data || []
    },

    async getConsultations(professionalId) {
      const { data, error } = await client
        .from('professional_consultations')
        .select('*')
        .eq('professional_id', professionalId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getOpenTasks() {
      const { data, error } = await client
        .from('tasks')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getTaskSubmissions(professionalId) {
      const { data, error } = await client
        .from('task_submissions')
        .select('*, tasks(title, compensation)')
        .eq('professional_id', professionalId)
      if (error) throw error
      return data || []
    },

    async updateSubscription(subscriptionId, updates) {
      const { error } = await client
        .from('subscriptions')
        .update(updates)
        .eq('id', subscriptionId)
      if (error) throw error
    },

    async createSubscription(professionalId, price, description) {
      const { error } = await client
        .from('subscriptions')
        .insert({ professional_id: professionalId, price: parseInt(price), description })
      if (error) throw error
    },

    async upsertConsultation(professionalId, consultation) {
      const { error } = await client
        .from('professional_consultations')
        .upsert({
          professional_id: professionalId,
          patient_id: professionalId,
          ...consultation,
          status: 'setup',
        }, { onConflict: 'professional_id' })
      if (error) throw error
    },

    async insertTaskSubmission(taskId, professionalId) {
      const { error } = await client
        .from('task_submissions')
        .insert({
          task_id: taskId,
          professional_id: professionalId,
          status: 'pending',
        })
      if (error) throw error
    },
  }
}

export const subscriptionRepository = createSubscriptionRepository()