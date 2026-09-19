import { useState, useEffect, useRef } from 'react';
import { theme } from '../../../styles/theme';

export default function ResultsMap({
  businesses,
  isLoading,
  error,
  onBusinessClick,
  center,
}) {
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapLoaded) return;

    // Dynamic import of Leaflet
    const loadMap = async () => {
      try {
        const L = await import('leaflet');
        await import('leaflet/dist/leaflet.css');

        // Create map
        const map = L.map(mapRef.current, {
          center: center || [6.5244, 3.3792], // Default to Lagos
          zoom: 12,
          zoomControl: false,
        });

        // Add zoom control to bottom right
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        // Store map instance
        mapRef.current._map = map;
        setMapLoaded(true);
      } catch (err) {
        console.error('Failed to load map:', err);
      }
    };

    loadMap();
  }, [center, mapLoaded]);

  // Update markers when businesses change
  useEffect(() => {
    if (!mapRef.current?._map || !mapLoaded) return;

    const updateMarkers = async () => {
      const L = await import('leaflet');
      const map = mapRef.current._map;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    // Add markers for each business
    const markers = [];
    businesses.forEach((business) => {
      if (business.latitude && business.longitude) {
        const marker = L.marker([business.latitude, business.longitude])
          .addTo(map)
          .bindPopup(`
            <div style="min-width: 200px;">
              <h4 style="margin: 0 0 4px 0; font-size: 14px;">${business.name}</h4>
              ${business.category ? `<p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">${business.category.name}</p>` : ''}
              ${business.address ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">${business.address}</p>` : ''}
              <button
                onclick="window.location.href='/business/${business.id}'"
                style="
                  padding: 4px 8px;
                  background: #0d9488;
                  color: white;
                  border: none;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                "
              >
                View Details
              </button>
            </div>
          `);

        marker.on('click', () => {
          setSelectedBusiness(business);
        });

        markers.push(marker);
      }
    });

    // Fit map to markers if we have any
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }

    // Add user location marker if center provided
    if (center) {
      L.circleMarker([center.lat, center.lng], {
        radius: 8,
        color: '#0d9488',
        fillColor: '#0d9488',
        fillOpacity: 1,
        weight: 2,
      })
        .addTo(map)
        .bindPopup('Your location');
    }
    };
    updateMarkers();
  }, [businesses, center, mapLoaded]);

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

  return (
    <div style={styles.container}>
      <div ref={mapRef} style={styles.map} />

      {/* Selected Business Card */}
      {selectedBusiness && (
        <div style={styles.selectedCard}>
          <div style={styles.cardHeader}>
            <h4 style={styles.cardTitle}>{selectedBusiness.name}</h4>
            <button
              onClick={() => setSelectedBusiness(null)}
              style={styles.closeButton}
            >
              Ã—
            </button>
          </div>
          {selectedBusiness.category && (
            <p style={styles.cardCategory}>{selectedBusiness.category.name}</p>
          )}
          {selectedBusiness.address && (
            <p style={styles.cardAddress}>{selectedBusiness.address}</p>
          )}
          <div style={styles.cardActions}>
            <button
              onClick={() => onBusinessClick(selectedBusiness)}
              style={styles.viewButton}
            >
              View Details
            </button>
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
