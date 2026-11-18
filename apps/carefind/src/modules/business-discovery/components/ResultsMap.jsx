import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { openMap } from '@care-ecosystem/design-system/components/maps/mapEngine';
import { theme } from '../../../styles/theme';
import { businessCoords } from '../../utils/marketplace.js';
import { GOOGLE_MAPS_KEY, loadLeaflet } from '../../../components/maps/mapProvider';

const BUSINESS_COLOR = '#0E6F5A';
const YOU_COLOR = '#2563eb';

// A marker's popup, built from text nodes. Business names, categories and addresses are admin/import sourced, so
// they must never be parsed as HTML (an `<img src=x onerror=...>` in a name would run in the visitor's session).
export function businessPopup(business) {
  const box = document.createElement('div');
  box.style.minWidth = '180px';
  const title = document.createElement('strong');
  title.textContent = business.name || '';
  box.appendChild(title);
  [business.category?.name, business.address].filter(Boolean).forEach((line) => {
    const div = document.createElement('div');
    div.style.fontSize = '12px';
    div.style.color = '#666';
    div.textContent = line;
    box.appendChild(div);
  });
  return box;
}

function textPopup(text) {
  const el = document.createElement('strong');
  el.textContent = text;
  return el;
}

// Search results on a map: Google Maps when a key is configured, OpenStreetMap otherwise (the shared map engine
// chooses, and falls back if Google is unavailable). Clicking a marker opens the business card below the map.
export default function ResultsMap({
  businesses,
  isLoading,
  error,
  onBusinessClick,
  center,
  open = openMap,
}) {
  const mapRef = useRef(null);
  const handleRef = useRef(null);
  const [mapStatus, setMapStatus] = useState('loading'); // loading | ready | failed
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const showMap = !isLoading && !error;
  const centerLat = center?.lat;
  const centerLng = center?.lng;

  // Open the map once its element exists.
  useEffect(() => {
    if (!showMap || !mapRef.current || handleRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const handle = await open(mapRef.current, {
          googleApiKey: GOOGLE_MAPS_KEY,
          loadLeaflet,
          center: centerLat != null && centerLng != null ? { lat: centerLat, lng: centerLng } : undefined,
          zoom: 12,
        });
        if (cancelled) { handle.destroy(); return; }
        handleRef.current = handle;
        setMapStatus('ready');
      } catch (err) {
        console.error('Failed to load map:', err);
        if (!cancelled) setMapStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
      if (handleRef.current) { handleRef.current.destroy(); handleRef.current = null; }
      setMapStatus('loading');
    };
  }, [showMap, open]); // center is read once, when the map opens; later changes are drawn as a marker

  // Draw the results (and the searcher's position) and fit the view to them.
  useEffect(() => {
    const handle = handleRef.current;
    if (mapStatus !== 'ready' || !handle) return;
    const markers = [];
    const points = [];
    (businesses || []).forEach((business) => {
      const coords = businessCoords(business);
      if (!coords) return;
      markers.push({
        lat: coords.lat, lng: coords.lng, color: BUSINESS_COLOR, radius: 8, fillOpacity: 0.85,
        title: business.name, popup: businessPopup(business),
        onClick: () => setSelectedBusiness(business),
      });
      points.push(coords);
    });
    if (centerLat != null && centerLng != null) {
      markers.push({ lat: centerLat, lng: centerLng, color: YOU_COLOR, radius: 7, fillOpacity: 1, title: 'Your location', popup: textPopup('Your location') });
    }
    handle.setMarkers(markers);
    if (points.length > 0) handle.fitTo(points, { padding: 40, maxZoom: 16, singleZoom: 15 });
  }, [businesses, centerLat, centerLng, mapStatus]);

  // Loading state
  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading map...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.errorContainer}>
        <ErrorIcon />
        <p style={styles.errorText}>Failed to load map</p>
        <p style={styles.errorHint}>{error.message}</p>
      </div>
    );
  }

  if (mapStatus === 'failed') {
    return (
      <div style={styles.errorContainer} role="status">
        <ErrorIcon />
        <p style={styles.errorText}>The map could not be loaded</p>
        <p style={styles.errorHint}>Switch to the list view to see the same results.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div ref={mapRef} style={styles.map} role="region" aria-label="Search results map" aria-busy={mapStatus === 'loading'} />

      {/* Selected Business Card */}
      {selectedBusiness && (
        <div style={styles.selectedCard}>
          <div style={styles.cardHeader}>
            <h4 style={styles.cardTitle}>{selectedBusiness.name}</h4>
            <button
              type="button"
              onClick={() => setSelectedBusiness(null)}
              aria-label="Close business details"
              style={styles.closeButton}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {selectedBusiness.category?.name && (
            <p style={styles.cardCategory}>{selectedBusiness.category.name}</p>
          )}
          {selectedBusiness.address && (
            <p style={styles.cardAddress}>{selectedBusiness.address}</p>
          )}
          <div style={styles.cardActions}>
            <Link
              to={`/business/${selectedBusiness.id}`}
              style={styles.viewButton}
            >
              View Details
            </Link>
            {selectedBusiness.phone && (
              <a
                href={`tel:${selectedBusiness.phone}`}
                style={styles.callButton}
              >
                Call
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
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

const styles = {
  container: {
    position: 'relative',
    height: '500px',
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    border: `1px solid ${theme.gray200}`,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '500px',
    gap: '16px',
    background: theme.gray50,
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
    height: '500px',
    gap: '12px',
    background: theme.gray50,
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
  selectedCard: {
    position: 'absolute',
    bottom: '16px',
    left: '16px',
    right: '16px',
    maxWidth: '320px',
    background: 'white',
    borderRadius: theme.radius.md,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    padding: '16px',
    zIndex: 1000,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: theme.gray900,
    margin: 0,
  },
  closeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    border: 'none',
    borderRadius: '50%',
    background: theme.gray100,
    color: theme.gray600,
    fontSize: '14px',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  cardCategory: {
    fontSize: '12px',
    color: theme.tealDeep,
    margin: '0 0 4px 0',
  },
  cardAddress: {
    fontSize: '12px',
    color: theme.gray600,
    margin: '0 0 12px 0',
  },
  cardActions: {
    display: 'flex',
    gap: '8px',
  },
  viewButton: {
    flex: 1,
    padding: '8px',
    background: theme.tealDeep,
    color: 'white',
    border: 'none',
    borderRadius: theme.radius.sm,
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  callButton: {
    flex: 1,
    padding: '8px',
    background: 'white',
    color: theme.tealDeep,
    border: `1px solid ${theme.tealDeep}`,
    borderRadius: theme.radius.sm,
    fontSize: '12px',
    fontWeight: '500',
    textAlign: 'center',
    textDecoration: 'none',
  },
};
