import { useState, useEffect } from 'react';
import { theme } from '../../../styles/theme';

export default function ResultsList({
  businesses,
  isLoading,
  error,
  onBusinessClick,
  showDistance,
  referenceLocation,
}) {
  // Loading state
  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Searching businesses...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.errorContainer}>
        <ErrorIcon />
        <p style={styles.errorText}>Failed to search businesses</p>
        <p style={styles.errorHint}>{error.message}</p>
      </div>
    );
  }

  // Empty state (spec 0001: honest empty, never invented)
  if (businesses.length === 0) {
    return (
      <div style={styles.emptyContainer}>
        <SearchIcon />
        <h3 style={styles.emptyTitle}>No verified result found</h3>
        <p style={styles.emptyText}>
          Try a larger radius, a named area, or different filters. Only verified directory rows appear here, and search never records a visit.
        </p>
      </div>
    );
  }

  // Results
  return (
    <div style={styles.list}>
      {businesses.map((business) => {
        // Calculate distance if reference location provided
        let distance = null;
        if (showDistance && referenceLocation && business.latitude && business.longitude) {
          distance = calculateDistance(
            referenceLocation.latitude,
            referenceLocation.longitude,
            business.latitude,
            business.longitude
          );
        }

        return (
          <BusinessCard
            key={business.id}
            business={business}
            onClick={onBusinessClick}
            showDistance={showDistance}
            distance={distance ? `${distance.toFixed(1)} km` : null}
          />
        );
      })}
    </div>
  );
}

// Helper function to calculate distance (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// Icon Components
function ErrorIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.danger || '#ef4444'} strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.gray300} strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

const styles = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    gap: '16px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: `3px solid ${theme.gray200}`,
    borderTopColor: theme.tealDeep,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    fontSize: '14px',
    color: theme.gray600,
    margin: 0,
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    gap: '12px',
  },
  errorText: {
    fontSize: '16px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
  },
  errorHint: {
    fontSize: '14px',
    color: theme.gray600,
    margin: 0,
    textAlign: 'center',
  },
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
    gap: '12px',
  },
  emptyTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
  },
  emptyText: {
    fontSize: '14px',
    color: theme.gray600,
    margin: 0,
    textAlign: 'center',
  },
};
