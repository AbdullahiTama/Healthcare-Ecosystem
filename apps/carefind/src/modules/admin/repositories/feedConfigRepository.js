import { supabase } from '../../../config/supabaseClient'

export function createFeedConfigRepository({ client }) {
  return {
    async getFeedRankingConfig() {
      const { data, error } = await client
        .from('feed_ranking_config').select('key, value')
      if (error) throw error
      return data || []
    },

    async getCandidatePools() {
      const { data, error } = await client
        .from('candidate_generation_pools').select('pool, label, enabled, priority, limit_count')
        .order('priority', { ascending: true })
      if (error) throw error
      return data || []
    },

    async getProfileAdmin(userId) {
      const { data, error } = await client
        .from('profiles').select('is_admin').eq('id', userId).maybeSingle()
      if (error) throw error
      return data
    },

    async setFeedRankingConfig(key, value) {
      const { error } = await client
        .rpc('set_feed_ranking_config', { p_key: key, p_value: value })
      if (error) throw error
    },

    async getExperiments() {
      const { data, error } = await client
        .from('content_distribution_experiments')
        .select('id, key, label, enabled, rollout_pct, variant, config, start_at, end_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getExperimentStats(experimentKey) {
      const { data, error } = await client
        .rpc('distribution_experiment_stats', { p_key: experimentKey })
      if (error) throw error
      return data
    },

    async setExperiment(key, updates) {
      const { error } = await client
        .rpc('set_distribution_experiment', { p_key: key, p_updates: updates })
      if (error) throw error
    },

    async getBusinessReviews(businessId) {
      const { data, error } = await client
        .from('reviews')
        .select('id, rating, comment, created_at, user_id, profiles(display_name)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },

    async getBusinessProducts(businessId) {
      const { data, error } = await client
        .from('products')
        .select('id, name, price, emoji, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  }
}

export const feedConfigRepository = createFeedConfigRepository({ client: supabase })
