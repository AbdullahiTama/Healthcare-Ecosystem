import { sbFetch } from '../../../services/supabase'

export function createWalletRepository({ request = sbFetch } = {}) {
  return {
    async getWallet(businessId) {
      return request(`business_wallets?business_id=eq.${businessId}`)
    },

    async getTransactions(businessId) {
      return request(`business_wallet_transactions?business_id=eq.${businessId}&order=created_at.desc&limit=100`)
    },

    async getWithdrawals(businessId) {
      return request(`business_withdrawal_requests?business_id=eq.${businessId}&order=created_at.desc&limit=50`)
    },

  }
}

export const walletRepository = createWalletRepository()
