import { useBreakpoint } from '../../../hooks/useBreakpoint';
import { CardSkeleton, Empty, ErrorState } from '../../../components/ui';
import { formatDistance, haversineMeters, businessCoords } from '../../utils/marketplace.js';
import BusinessCard from '../../business-directory/components/BusinessCard';

// The list half of the radius-discovery view (the map half is ResultsMap).
//
// Loading, empty and error all go through the shared design-system components
// rather than hand-rolled markup, so this surface has the same three states as
// every other list in the app (docs/design/DESIGN_PRINCIPLES.md:115).
//
// The loading state is a skeleton rather than the previous hand-rolled spinner:
// MOTION.md:40 requires skeletons for known-shape layouts, and a row of cards is
// a known shape. The skeleton pulses rather than sweeps, and
// prefers-reduced-motion is handled globally in styles/global.css.

export default function ResultsList({
  businesses,
  isLoading,
  error,
  onClearFilters,
  showDistance,
  referenceLocation,
}) {
  const { isMobile } = useBreakpoint();

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        role="status"
        aria-live="polite"
        aria-label="Searching businesses"
      >
        {[0, 1, 2].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        variant="network"
        message={error?.message || 'We could not load healthcare businesses. Check your connection and try again.'}
      />
    );
  }

  if (!businesses || businesses.length === 0) {
    return (
      <Empty
        cause="filtered"
        message="No businesses match these filters"
        action="Clear filters"
        onAction={onClearFilters}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {businesses.map((business) => {
        // Prefer the PostGIS distance the search_nearby_businesses RPC already
        // computed; fall back to computing it here for the non-geo query path.
        let distance = null;
        if (showDistance) {
          if (typeof business.distance_m === 'number' && Number.isFinite(business.distance_m)) {
            distance = formatDistance(business.distance_m);
          } else {
            const bc = businessCoords(business);
            if (bc && referenceLocation) {
              distance = formatDistance(
                haversineMeters(referenceLocation.latitude, referenceLocation.longitude, bc.lat, bc.lng),
              );
            }
          }
        }

        return (
          <BusinessCard
            key={business.id}
            business={business}
            showDistance={showDistance}
            distance={distance}
            compact={isMobile}
          />
        );
      })}
    </div>
  );
}
