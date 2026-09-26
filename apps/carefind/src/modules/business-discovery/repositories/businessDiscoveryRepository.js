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
    verificationStatus = null,
    dataSource = null,
    sortBy = 'relevance',
    page = 1,
    limit = 20,
  }) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);
    let queryBuilder = supabase
      .from('business_directory')
      .select(`
        *,
        category:business_categories(id, name, slug, icon),
        subcategory:business_subcategories(id, name, slug)
      `, { count: 'exact' })
      .eq('is_active', true)
      .eq('is_demo', false);

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

    // Location-based search (spec 0001: meters, filters, paging)
    if (latitude && longitude) {
      // Use PostGIS function for distance calculation
      const { data: nearbyData, error: nearbyError } = await supabase
        .rpc('search_nearby_businesses', {
          p_latitude: latitude,
          p_longitude: longitude,
          p_radius_m: Math.round(Math.min(Math.max(radiusKm, 1), 25) * 1000),
          p_category_id: categoryId || null,
          p_state: state || null,
          p_lga: lga || null,
          p_verification_status: verificationStatus,
          p_data_source: dataSource,
          p_limit: safeLimit,
          p_offset: (safePage - 1) * safeLimit,
        });

      if (nearbyError) throw nearbyError;

      // Map flat RPC response to expected shape for ResultsMap/ResultsList
      const mapped = (nearbyData || []).map((row) => ({
        ...row,
        category: row.category_name ? { name: row.category_name } : null,
        distance_m: row.distance_m,
      }));

      return {
        data: mapped,
        total: mapped.length,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(mapped.length / safeLimit),
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
    const from = (safePage - 1) * safeLimit;
    const to = from + safeLimit - 1;
    queryBuilder = queryBuilder.range(from, to);

    const { data, error, count } = await queryBuilder;

    if (error) throw error;

    return {
      data: data || [],
      total: count || 0,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil((count || 0) / safeLimit),
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
      .eq('is_active', true)
      .eq('is_demo', false)
      .eq('category_id', categoryId)
      .neq('id', businessId)
      .limit(limit);

    if (error) throw error;
    return data || [];
  },
};

export default businessDiscoveryRepository;
