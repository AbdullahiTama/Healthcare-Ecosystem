import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vendorRatingRepository } from '../vendorRatingRepository'

// Mock supabase
vi.mock('../../../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { supabase } from '../../../config/supabaseClient'

describe('vendorRatingRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('creates a rating with all required fields', async () => {
      const mockRating = {
        id: 'rating-1',
        order_id: 'order-1',
        vendor_business_id: 'vendor-1',
        customer_id: 'customer-1',
        fulfillment_speed: 5,
        packaging_quality: 4,
        accuracy: 5,
        overall_rating: 5,
        comment: 'Great!',
      }

      const mockSingle = vi.fn().mockResolvedValue({ data: mockRating, error: null })
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
      supabase.from.mockReturnValue({ insert: mockInsert })

      const result = await vendorRatingRepository.create(
        'order-1',
        'vendor-1',
        'customer-1',
        { fulfillmentSpeed: 5, packagingQuality: 4, accuracy: 5, overall: 5 },
        'Great!'
      )

      expect(supabase.from).toHaveBeenCalledWith('vendor_ratings')
      expect(mockInsert).toHaveBeenCalledWith({
        order_id: 'order-1',
        vendor_business_id: 'vendor-1',
        customer_id: 'customer-1',
        fulfillment_speed: 5,
        packaging_quality: 4,
        accuracy: 5,
        overall_rating: 5,
        comment: 'Great!',
      })
      expect(result).toEqual(mockRating)
    })

    it('handles null comment', async () => {
      const mockRating = { id: 'rating-1', comment: null }
      const mockSingle = vi.fn().mockResolvedValue({ data: mockRating, error: null })
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
      supabase.from.mockReturnValue({ insert: mockInsert })

      await vendorRatingRepository.create(
        'order-1',
        'vendor-1',
        'customer-1',
        { fulfillmentSpeed: 5, packagingQuality: 4, accuracy: 5, overall: 5 },
        null
      )

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ comment: null })
      )
    })
  })

  describe('getByOrder', () => {
    it('returns rating for order', async () => {
      const mockRating = { id: 'rating-1', order_id: 'order-1' }
      const mockSingle = vi.fn().mockResolvedValue({ data: mockRating, error: null })
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      supabase.from.mockReturnValue({ select: mockSelect })

      const result = await vendorRatingRepository.getByOrder('order-1')

      expect(supabase.from).toHaveBeenCalledWith('vendor_ratings')
      expect(mockEq).toHaveBeenCalledWith('order_id', 'order-1')
      expect(result).toEqual(mockRating)
    })

    it('returns null when no rating found', async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      supabase.from.mockReturnValue({ select: mockSelect })

      const result = await vendorRatingRepository.getByOrder('order-1')

      expect(result).toBeNull()
    })
  })

  describe('getVendorStats', () => {
    it('returns stats from RPC', async () => {
      const mockStats = {
        total_ratings: 10,
        avg_overall: 4.5,
        avg_fulfillment_speed: 4.3,
        avg_packaging_quality: 4.6,
        avg_accuracy: 4.8,
      }

      supabase.rpc.mockResolvedValue({ data: [mockStats], error: null })

      const result = await vendorRatingRepository.getVendorStats('vendor-1')

      expect(supabase.rpc).toHaveBeenCalledWith('get_vendor_rating_stats', {
        p_vendor_business_id: 'vendor-1',
      })
      expect(result).toEqual(mockStats)
    })

    it('returns default stats when no data', async () => {
      supabase.rpc.mockResolvedValue({ data: [], error: null })

      const result = await vendorRatingRepository.getVendorStats('vendor-1')

      expect(result).toEqual({
        total_ratings: 0,
        avg_overall: 0,
        avg_fulfillment_speed: 0,
        avg_packaging_quality: 0,
        avg_accuracy: 0,
      })
    })
  })
})
