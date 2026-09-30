import { useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import SearchBar from './components/SearchBar';
import SearchFilters from './components/SearchFilters';
import ResultsList from './components/ResultsList';
import ResultsMap from './components/ResultsMap';
import { useBusinessDiscovery } from './hooks';
import { useLocation } from '../business-directory/hooks';

export default function BusinessDiscoveryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { getCurrentLocation } = useLocation();
  const { isMobileOrTablet } = useBreakpoint();

  // View state
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'map'

  // Search state from URL params
  const searchState = useMemo(() => ({
    query: searchParams.get('q') || '',
    category: searchParams.get('category') || '',
    state: searchParams.get('state') || '',
    lga: searchParams.get('lga') || '',
    latitude: searchParams.get('lat') ? parseFloat(searchParams.get('lat')) : null,
    longitude: searchParams.get('lng') ? parseFloat(searchParams.get('lng')) : null,
    radius: searchParams.get('radius') ? parseInt(searchParams.get('radius')) : 10,
    sortBy: searchParams.get('sort') || 'relevance',
    page: searchParams.get('page') ? parseInt(searchParams.get('page')) : 1,
  }), [searchParams]);

  // Search query (spec 0001: radius clamps to 1..25 km, server caps at 200 rows)
  const {
    data: searchResults,
    isLoading,
    error,
  } = useBusinessDiscovery({
    query: searchState.query,
    categoryId: searchState.category,
    state: searchState.state,
    lga: searchState.lga,
    latitude: searchState.latitude,
    longitude: searchState.longitude,
    radiusKm: Math.min(Math.max(searchState.radius || 10, 1), 25),
    sortBy: searchState.sortBy,
    page: searchState.page,
    limit: 20,
  });

  // Update search params
  const updateSearchParams = useCallback((updates) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '' || value === undefined) {
          newParams.delete(key);
        } else {
          newParams.set(key, String(value));
        }
      });
      // Reset to page 1 on filter change
      if (!updates.page) {
        newParams.set('page', '1');
      }
      return newParams;
    });
  }, [setSearchParams]);

  // Handle search
  const handleSearch = useCallback((query) => {
    updateSearchParams({ q: query });
  }, [updateSearchParams]);

  // Handle filter change
  const handleFilterChange = useCallback((filters) => {
    updateSearchParams(filters);
  }, [updateSearchParams]);

  // Handle location search
  const handleLocationSearch = useCallback(async () => {
    try {
      const position = await getCurrentLocation();
      updateSearchParams({
        lat: position.latitude.toFixed(6),
        lng: position.longitude.toFixed(6),
        sort: 'distance',
      });
    } catch (err) {
      console.error('Failed to get location:', err);
    }
  }, [getCurrentLocation, updateSearchParams]);

  // Handle clear location
  const handleClearLocation = useCallback(() => {
    updateSearchParams({ lat: null, lng: null, sort: 'relevance' });
  }, [updateSearchParams]);

  // Handle clearing every filter from the results empty state.
  const handleClearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  // Handle pagination
  const handlePageChange = useCallback((page) => {
    updateSearchParams({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [updateSearchParams]);

  // Handle business click
  // The list row and the map card are both router links now, so this is only
  // used by the map's marker-click selection, not for navigation.
  const handleBusinessClick = useCallback((business) => {
    navigate(`/business/${business.id}`);
  }, [navigate]);

  const businesses = searchResults?.data || [];
  const totalCount = searchResults?.total || 0;
  const hasLocation = searchState.latitude && searchState.longitude;

  return (
    <div style={styles.container} data-surface="discovery">
      {/* Search Header */}
      <div
        style={{
          ...styles.header,
          // Title and view toggle compete for the same row below laptop; the
          // toggle drops below the copy rather than squeezing it.
          flexDirection: isMobileOrTablet ? 'column' : 'row',
          gap: isMobileOrTablet ? 16 : 24,
        }}
      >
        <div style={styles.headerContent}>
          <h1 style={styles.title}>Find Healthcare Businesses</h1>
          <p style={styles.subtitle}>
            Search pharmacies, hospitals, clinics, and more near you
          </p>
        </div>

        {/* View Toggle */}
        <div style={styles.viewToggle}>
          <button
            style={{
              ...styles.viewButton,
              ...(viewMode === 'list' ? styles.viewButtonActive : {}),
            }}
            onClick={() => setViewMode('list')}
          >
            <ListIcon />
            List
          </button>
          <button
            style={{
              ...styles.viewButton,
              ...(viewMode === 'map' ? styles.viewButtonActive : {}),
            }}
            onClick={() => setViewMode('map')}
          >
            <MapIcon />
            Map
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <SearchBar
        value={searchState.query}
        onSearch={handleSearch}
        onLocationSearch={handleLocationSearch}
        hasLocation={hasLocation}
      />
      <p style={styles.consentNotice}>
        {hasLocation
          ? 'Using your location to rank nearby results. Search never records a visit.'
          : 'Location is optional. Your browser asks permission before sharing GPS.'}
      </p>

      {/* Main Content */}
      <div
        style={{
          ...styles.main,
          // The fixed 280px filter rail forced a 474px document at 375px wide
          // (verified in a real browser). Below laptop the filters stack above
          // the results instead of sitting beside them.
          gridTemplateColumns: isMobileOrTablet ? 'minmax(0, 1fr)' : '280px minmax(0, 1fr)',
          gap: isMobileOrTablet ? 20 : 24,
        }}
      >
        {/* Filters Sidebar */}
        <aside style={{ ...styles.sidebar, position: isMobileOrTablet ? 'static' : 'sticky' }}>
          <SearchFilters
            filters={searchState}
            onFilterChange={handleFilterChange}
            onClearLocation={handleClearLocation}
            hasLocation={hasLocation}
          />
        </aside>

        {/* Results */}
        <main style={styles.results}>
          {/* Results Header */}
          <div style={styles.resultsHeader}>
            <span style={styles.resultCount}>
              {isLoading ? (
                'Searching...'
              ) : (
                <>
                  {totalCount.toLocaleString()} {totalCount === 1 ? 'business' : 'businesses'} found
                  {hasLocation && ' nearby'}
                </>
              )}
            </span>
          </div>

          {/* Results Content */}
          {viewMode === 'list' ? (
            <ResultsList
              businesses={businesses}
              isLoading={isLoading}
              error={error}
              onBusinessClick={handleBusinessClick}
              onClearFilters={handleClearFilters}
              showDistance={hasLocation}
              referenceLocation={hasLocation ? { latitude: searchState.latitude, longitude: searchState.longitude } : null}
            />
          ) : (
            <ResultsMap
              businesses={businesses}
              isLoading={isLoading}
              error={error}
              onBusinessClick={handleBusinessClick}
              center={hasLocation ? { lat: searchState.latitude, lng: searchState.longitude } : null}
            />
          )}

          {/* Pagination */}
          {totalCount > 20 && (
            <div style={styles.pagination}>
              <button
                style={styles.pageButton}
                onClick={() => handlePageChange(searchState.page - 1)}
                disabled={searchState.page <= 1}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>
                Page {searchState.page} of {Math.ceil(totalCount / 20)}
              </span>
              <button
                style={styles.pageButton}
                onClick={() => handlePageChange(searchState.page + 1)}
                disabled={searchState.page >= Math.ceil(totalCount / 20)}
              >
                Next
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// Icon Components
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px 16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: '24px',
    fontWeight: '700',
    color: theme.gray900,
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: theme.gray600,
    margin: 0,
  },
  viewToggle: {
    display: 'flex',
    gap: '4px',
    background: theme.gray100,
    borderRadius: theme.radius.md,
    padding: '4px',
  },
  viewButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    // 44px touch floor (ACCESSIBILITY.md:32); padding alone rendered 32px.
    minHeight: 44,
    padding: '8px 12px',
    border: 'none',
    borderRadius: theme.radius.sm,
    background: 'transparent',
    color: theme.gray600,
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: `all ${theme.motion.fast} ${theme.motion.easeOut}`,
  },
  viewButtonActive: {
    background: 'white',
    color: theme.tealDeep,
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  },
  main: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    gap: '24px',
    alignItems: 'flex-start',
  },
  sidebar: {
    position: 'sticky',
    top: '24px',
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  resultsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultCount: {
    fontSize: '14px',
    color: theme.gray600,
  },
  consentNotice: {
    fontSize: '12px',
    color: theme.gray500,
    margin: '8px 0 0 0',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
    paddingTop: '24px',
  },
  pageButton: {
    padding: '8px 16px',
    border: `1px solid ${theme.gray200}`,
    borderRadius: theme.radius.md,
    background: 'white',
    // theme.gray700 does not exist in the token set (gray50/100/200/300/400/
    // 500/600/900), so this resolved to undefined and the text inherited.
    color: theme.gray600,
    fontSize: '14px',
    cursor: 'pointer',
    transition: `all ${theme.motion.fast} ${theme.motion.easeOut}`,
    // 44px minimum touch target (ACCESSIBILITY.md:32); the padding above
    // alone rendered this at ~35px tall.
    minHeight: 44,
  },
  pageInfo: {
    fontSize: '14px',
    color: theme.gray600,
  },
};
