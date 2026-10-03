import { useQuery } from '@tanstack/react-query';
import { businessDiscoveryRepository } from '../repositories/businessDiscoveryRepository';

export function useBusinessDiscovery({
  query,
  categoryId,
  state,
  lga,
  latitude,
  longitude,
  radiusKm,
  sortBy,
  page,
  limit,
}) {
  return useQuery({
    queryKey: ['businessDiscovery', { query, categoryId, state, lga, latitude, longitude, radiusKm, sortBy, page, limit }],
    queryFn: () =>
      businessDiscoveryRepository.search({
        query,
        categoryId,
        state,
        lga,
        latitude,
        longitude,
        radiusKm,
        sortBy,
        page,
        limit,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useBusinessDiscoveryCategories() {
  return useQuery({
    queryKey: ['businessDiscoveryCategories'],
    queryFn: () => businessDiscoveryRepository.getCategories(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useBusinessDiscoveryStats() {
  return useQuery({
    queryKey: ['businessDiscoveryStats'],
    queryFn: () => businessDiscoveryRepository.getStats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export default {
  useBusinessDiscovery,
  useBusinessDiscoveryCategories,
  useBusinessDiscoveryStats,
};
