import { supabase } from '../../../config/supabaseClient';

export const businessDiscoveryRepository = {
  /**
   * Search businesses with filters
   */
  async search({
    query,
    categoryId,
    state,
    lga,
    latitude,
    longitude,
    radiusKm = 10,
    sortBy = 'relevance',
    page = 1,
    limit = 20,
  }) {
    let queryBuilder = supabase
      .from('business_directory')
      .select(`
        *,
        category:business_categories(id, name, slug, icon),
        subcategory:business_subcategories(id, name, slug)
      `, { count: 'exact' });

    // Text search
    if (query) {
      queryBuilder = queryBuilder.or(`name.ilike.%${query}%,address.ilike.%${query}%,phone.ilike.%${query}%`);
    }

    // Category filter
    if (categoryId) {
      queryBuilder = queryBuilder.eq('category_id', categoryId);
    }

    // State filter
    if (state) {
      queryBuilder = queryBuilder.eq('state', state);
    }

    // LGA filter
    if (lga) {
      queryBuilder = queryBuilder.eq('lga', lga);
    }

    // Location-based search
    if (latitude && longitude) {
      // Use PostGIS function for distance calculation
      const { data: nearbyData, error: nearbyError } = await supabase
        .rpc('search_nearby_businesses', {
          p_latitude: latitude,
          p_longitude: longitude,
          p_radius_km: radiusKm,
          p_category_id: categoryId,
          p_limit: limit,
        });

      if (nearbyError) throw nearbyError;

      // Map flat RPC response to expected shape for ResultsMap/ResultsList
      const mapped = (nearbyData || []).map((row) => ({
        ...row,
        category: row.category_name ? { name: row.category_name } : null,
      }));

      return {
        data: mapped,
        total: mapped.length,
        page,
        limit,
        totalPages: Math.ceil(mapped.length / limit),
      };
    }

    // Sorting
    switch (sortBy) {
      case 'distance':
        if (latitude && longitude) {
          // Already sorted by distance from PostGIS function
          break;
        }
        // Fall through to name sort if no location
        queryBuilder = queryBuilder.order('name', { ascending: true });
        break;
      case 'name':
        queryBuilder = queryBuilder.order('name', { ascending: true });
        break;
      case 'newest':
        queryBuilder = queryBuilder.order('created_at', { ascending: false });
        break;
      case 'verified':
        queryBuilder = queryBuilder.order('verification_status', { ascending: true });
        break;
      default: // relevance
        if (query) {
          // Use full-text search ranking
          queryBuilder = queryBuilder.textSearch('name', query, { type: 'websearch' });
        } else {
          queryBuilder = queryBuilder.order('name', { ascending: true });
        }
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    queryBuilder = queryBuilder.range(from, to);

    const { data, error, count } = await queryBuilder;

    if (error) throw error;

    return {
      data: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  },

  /**
   * Get categories for filters
   */
  async getCategories() {
    const { data, error } = await supabase
      .from('business_categories')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  /**
   * Get discovery stats
   */
  async getStats() {
    const { data, error } = await supabase
      .rpc('get_business_stats');

    if (error) throw error;
    return data;
  },

  /**
   * Get business by ID with full details
   */
  async getBusinessById(id) {
    const { data, error } = await supabase
      .from('business_directory')
      .select(`
        *,
        category:business_categories(id, name, slug, icon, color),
        subcategory:business_subcategories(id, name, slug),
        verifications:business_verification(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get similar businesses
   */
  async getSimilarBusinesses(businessId, categoryId, limit = 5) {
    const { data, error } = await supabase
      .from('business_directory')
      .select(`
        *,
        category:business_categories(id, name, slug, icon)
      `)
      .eq('category_id', categoryId)
      .neq('id', businessId)
      .limit(limit);

    if (error) throw error;
    return data || [];
  },
};

export default businessDiscoveryRepository;
