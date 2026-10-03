import { supabase } from '../../../config/supabaseClient.js'

export function createWalletRepository({ client = supabase } = {}) {
  return {
    async getBalance(userId) {
      const { data, error } = await client
        .from('wallets').select('balance').eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data
    },

    async getWallet(userId) {
      const { data, error } = await client
        .from('wallets').select('*').eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data
    },

    async ensureWallet(userId) {
      let { data: wallet } = await client
        .from('wallets').select('*').eq('user_id', userId).maybeSingle()
      if (!wallet) {
        const { data: newWallet } = await client
          .from('wallets').insert({ user_id: userId, balance: 0 }).select().single()
        wallet = newWallet
      }
      return wallet
    },

    async getTransactions(userId, limit = 20) {
      const { data, error } = await client
        .from('transactions').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return data || []
    },
  }
}

export const walletRepository = createWalletRepository()
