import { supabase } from '../../../config/supabaseClient.js';

/**
 * Business Directory Repository
 * Handles all database operations for the business directory
 */
export function createBusinessDirectoryRepository({ client = supabase } = {}) {
  return {
    // =====================================================
    // CRUD Operations
    // =====================================================

    /**
     * Get business by ID
     */
    async getBusinessById(id) {
      const { data, error } = await client
        .from('business_directory')
        .select(`
          *,
          category:business_categories(id, name, slug, icon, color),
          subcategory:business_subcategories(id, name, slug)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * List businesses with filters and pagination
     */
    async listBusinesses(filters = {}, pagination = { page: 1, limit: 20 }) {
      const { page = 1, limit = 20 } = pagination;
      const offset = (page - 1) * limit;

      let query = client
        .from('business_directory')
        .select(`
          *,
          category:business_categories(id, name, slug, icon, color),
          subcategory:business_subcategories(id, name, slug)
        `, { count: 'exact' });

      // Apply filters
      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,address.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
      }
      if (filters.category_id) {
        query = query.eq('category_id', filters.category_id);
      }
      if (filters.subcategory_id) {
        query = query.eq('subcategory_id', filters.subcategory_id);
      }
      if (filters.state) {
        query = query.eq('state', filters.state);
      }
      if (filters.lga) {
        query = query.eq('lga', filters.lga);
      }
      if (filters.verification_status) {
        query = query.eq('verification_status', filters.verification_status);
      }
      if (filters.is_active !== undefined) {
        query = query.eq('is_active', filters.is_active);
      }
      if (filters.data_source) {
        query = query.eq('data_source', filters.data_source);
      }

      // Apply sorting
      const sortField = filters.sort || 'created_at';
      const sortDirection = filters.order || 'desc';
      query = query.order(sortField, { ascending: sortDirection === 'asc' });

      // Apply pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        data,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      };
    },

    /**
     * Create a new business
     */
    async createBusiness(businessData) {
      const { data, error } = await client
        .from('business_directory')
        .insert(businessData)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Update a business
     */
    async updateBusiness(id, businessData) {
      const { data, error } = await client
        .from('business_directory')
        .update(businessData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Delete a business (soft delete by setting is_active = false)
     */
    async deleteBusiness(id) {
      const { data, error } = await client
        .from('business_directory')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    // =====================================================
    // Search Operations
    // =====================================================

    /**
     * Search businesses by text
     */
    async searchBusinesses(query, filters = {}) {
      let searchQuery = client
        .from('business_directory')
        .select(`
          *,
          category:business_categories(id, name, slug, icon, color),
          subcategory:business_subcategories(id, name, slug)
        `)
        .eq('is_active', true);

      if (query) {
        searchQuery = searchQuery.or(`name.ilike.%${query}%,address.ilike.%${query}%,phone.ilike.%${query}%`);
      }

      // Apply filters
      if (filters.category_id) {
        searchQuery = searchQuery.eq('category_id', filters.category_id);
      }
      if (filters.state) {
        searchQuery = searchQuery.eq('state', filters.state);
      }
      if (filters.lga) {
        searchQuery = searchQuery.eq('lga', filters.lga);
      }
      if (filters.verification_status) {
        searchQuery = searchQuery.eq('verification_status', filters.verification_status);
      }

      // Limit results
      searchQuery = searchQuery.limit(filters.limit || 20);

      const { data, error } = await searchQuery;

      if (error) throw error;
      return data;
    },

    /**
     * Search nearby businesses using PostGIS
     */
    async searchNearby(latitude, longitude, radiusKm = 5, categoryId = null, limit = 20) {
      const { data, error } = await client
        .rpc('search_nearby_businesses', {
          p_latitude: latitude,
          p_longitude: longitude,
          p_radius_km: radiusKm,
          p_category_id: categoryId,
          p_limit: limit,
        });

      if (error) throw error;
      return data;
    },

    /**
     * Search businesses by category and location
     */
    async searchByCategory(categoryId, location = {}, radiusKm = 5) {
      let query = client
        .from('business_directory')
        .select(`
          *,
          category:business_categories(id, name, slug, icon, color),
          subcategory:business_subcategories(id, name, slug)
        `)
        .eq('is_active', true)
        .eq('category_id', categoryId);

      if (location.latitude && location.longitude) {
        // Use PostGIS for distance calculation
        const { data, error } = await client
          .rpc('search_nearby_businesses', {
            p_latitude: location.latitude,
            p_longitude: location.longitude,
            p_radius_km: radiusKm,
            p_category_id: categoryId,
            p_limit: 50,
          });

        if (error) throw error;
        return data;
      }

      // Fallback to simple query if no location
      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data;
    },

    // =====================================================
    // Import Operations
    // =====================================================

    /**
     * Create an import batch
     */
    async createImportBatch(filename, totalRecords, fileUrl = null) {
      const { data: { user } } = await client.auth.getUser();

      const { data, error } = await client
        .from('business_import_batches')
        .insert({
          filename,
          file_url: fileUrl,
          total_records: totalRecords,
          imported_by: user.id,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Update import batch status
     */
    async updateImportBatch(batchId, updates) {
      const { data, error } = await client
        .from('business_import_batches')
        .update(updates)
        .eq('id', batchId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Add import error
     */
    async addImportError(batchId, rowNumber, errorType, errorMessage, rawData = null, fieldName = null) {
      const { data, error } = await client
        .from('business_import_errors')
        .insert({
          batch_id: batchId,
          row_number: rowNumber,
          error_type: errorType,
          error_message: errorMessage,
          raw_data: rawData,
          field_name: fieldName,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Get import batch by ID
     */
    async getImportBatch(batchId) {
      const { data, error } = await client
        .from('business_import_batches')
        .select('*')
        .eq('id', batchId)
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Get import errors for a batch
     */
    async getImportErrors(batchId) {
      const { data, error } = await client
        .from('business_import_errors')
        .select('*')
        .eq('batch_id', batchId)
        .order('row_number');

      if (error) throw error;
      return data;
    },

    /**
     * Get import history
     */
    async getImportHistory(pagination = { page: 1, limit: 10 }) {
      const { page = 1, limit = 10 } = pagination;
      const offset = (page - 1) * limit;

      const { data, error, count } = await client
        .from('business_import_batches')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        data,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      };
    },

    // =====================================================
    // Verification Operations
    // =====================================================

    /**
     * Verify a business
     */
    async verifyBusiness(businessId, status, notes = null, evidenceUrl = null) {
      const { data: { user } } = await client.auth.getUser();

      // Create verification record
      const { data: verification, error: verificationError } = await client
        .from('business_verification')
        .insert({
          business_id: businessId,
          verifier_id: user.id,
          status,
          notes,
          evidence_url: evidenceUrl,
          verified_at: status !== 'pending' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (verificationError) throw verificationError;

      // Update business verification status
      const { error: updateError } = await client
        .from('business_directory')
        .update({
          verification_status: status,
          verified_at: status !== 'pending' ? new Date().toISOString() : null,
          verified_by: status !== 'pending' ? user.id : null,
        })
        .eq('id', businessId);

      if (updateError) throw updateError;

      return verification;
    },

    /**
     * Get verification history for a business
     */
    async getVerificationHistory(businessId) {
      const { data, error } = await client
        .from('business_verification')
        .select(`
          *,
          verifier:admin_users(id, full_name, email)
        `)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },

    // =====================================================
    // Category Operations
    // =====================================================

    /**
     * Get all categories
     */
    async getCategories() {
      const { data, error } = await client
        .from('business_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return data;
    },

    /**
     * Get subcategories for a category
     */
    async getSubcategories(categoryId) {
      const { data, error } = await client
        .from('business_subcategories')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return data;
    },

    /**
     * Create a category
     */
    async createCategory(categoryData) {
      const { data, error } = await client
        .from('business_categories')
        .insert(categoryData)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Update a category
     */
    async updateCategory(id, categoryData) {
      const { data, error } = await client
        .from('business_categories')
        .update(categoryData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    /**
     * Delete a category (soft delete)
     */
    async deleteCategory(id) {
      const { data, error } = await client
        .from('business_categories')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },

    // =====================================================
    // Statistics
    // =====================================================

    /**
     * Get business directory statistics
     */
    async getStats() {
      const { data, error } = await client
        .rpc('get_business_stats');

      if (error) throw error;
      return data;
    },
  };
}

// Default singleton instance
export const businessDirectoryRepository = createBusinessDirectoryRepository();
