/**
 * Location Service
 * Handles geocoding, distance calculations, and location utilities
 */

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

/**
 * Get current device position
 */
export async function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
        ...options,
      }
    );
  });
}

/**
 * Watch device position
 */
export function watchPosition(callback, options = {}) {
  if (!navigator.geolocation) {
    throw new Error('Geolocation is not supported by this browser');
  }

  return navigator.geolocation.watchPosition(
    (position) => {
      callback({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp,
      });
    },
    (error) => {
      callback(null, error);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
      ...options,
    }
  );
}

/**
 * Stop watching position
 */
export function clearWatch(watchId) {
  navigator.geolocation.clearWatch(watchId);
}

/**
 * Geocode an address to coordinates
 */
export async function geocodeAddress(address) {
  try {
    const response = await fetch(
      `${NOMINATIM_BASE_URL}/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=ng`
    );
    const data = await response.json();

    if (data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        displayName: data[0].display_name,
        type: data[0].type,
        importance: data[0].importance,
      };
    }

    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    throw error;
  }
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(latitude, longitude) {
  try {
    const response = await fetch(
      `${NOMINATIM_BASE_URL}/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
    );
    const data = await response.json();

    if (data) {
      return {
        displayName: data.display_name,
        address: data.address || {},
        type: data.type,
        osmId: data.osm_id,
      };
    }

    return null;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    throw error;
  }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate distance using PostGIS (server-side)
 */
export async function calculateDistancePostGIS(lat1, lng1, lat2, lng2) {
  // This would be called via Supabase RPC
  // For client-side, use calculateDistance instead
  return calculateDistance(lat1, lng1, lat2, lng2);
}

/**
 * Get default radius based on location type
 */
export function getDefaultRadius(locationType = 'urban') {
  const radiusMap = {
    urban: 1, // 1 km for urban areas
    suburban: 3, // 3 km for suburban areas
    rural: 5, // 5 km for rural areas
    default: 5,
  };

  return radiusMap[locationType] || radiusMap.default;
}

/**
 * Format distance for display
 */
export function formatDistance(distanceKm) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`;
  }
  return `${distanceKm.toFixed(1)}km`;
}

/**
 * Get approximate location description
 */
export function getApproximateLocation(distanceKm) {
  if (distanceKm < 0.1) {
    return 'At this location';
  }
  if (distanceKm < 0.5) {
    return 'Very close';
  }
  if (distanceKm < 1) {
    return 'Less than 1 km away';
  }
  if (distanceKm < 5) {
    return `About ${Math.round(distanceKm)} km away`;
  }
  return `About ${distanceKm.toFixed(1)} km away`;
}

/**
 * Check if a point is within a bounding box
 */
export function isWithinBounds(latitude, longitude, bounds) {
  const { north, south, east, west } = bounds;
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}

/**
 * Calculate bounding box for a point and radius
 */
export function calculateBoundingBox(latitude, longitude, radiusKm) {
  const latDelta = radiusKm / 111.32; // 1 degree latitude ≈ 111.32 km
  const lngDelta = radiusKm / (111.32 * Math.cos(toRadians(latitude)));

  return {
    north: latitude + latDelta,
    south: latitude - latDelta,
    east: longitude + lngDelta,
    west: longitude - lngDelta,
  };
}

/**
 * Sort locations by distance from a reference point
 */
export function sortByDistance(locations, referenceLat, referenceLng) {
  return locations
    .map((location) => ({
      ...location,
      distance: calculateDistance(referenceLat, referenceLng, location.latitude, location.longitude),
    }))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Filter locations within radius
 */
export function filterWithinRadius(locations, referenceLat, referenceLng, radiusKm) {
  return locations.filter((location) => {
    const distance = calculateDistance(referenceLat, referenceLng, location.latitude, location.longitude);
    return distance <= radiusKm;
  });
}

/**
 * Get center point of multiple locations
 */
export function getCenterPoint(locations) {
  if (locations.length === 0) {
    return null;
  }

  const sum = locations.reduce(
    (acc, location) => ({
      lat: acc.lat + location.latitude,
      lng: acc.lng + location.longitude,
    }),
    { lat: 0, lng: 0 }
  );

  return {
    latitude: sum.lat / locations.length,
    longitude: sum.lng / locations.length,
  };
}

// Helper function
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

export default {
  getCurrentPosition,
  watchPosition,
  clearWatch,
  geocodeAddress,
  reverseGeocode,
  calculateDistance,
  calculateDistancePostGIS,
  getDefaultRadius,
  formatDistance,
  getApproximateLocation,
  isWithinBounds,
  calculateBoundingBox,
  sortByDistance,
  filterWithinRadius,
  getCenterPoint,
};
