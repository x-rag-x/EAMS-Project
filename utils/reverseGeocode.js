const geoCache = new Map();
const MAX_CACHE_SIZE = 500;

/**
 * Reverse Geocode helper to convert (latitude, longitude) to readable location address.
 * Uses OpenStreetMap Nominatim with an in-memory LRU-like cache, short timeout, and graceful fallback.
 */
async function reverseGeocode(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return '';
  }

  const latNum = parseFloat(latitude);
  const lngNum = parseFloat(longitude);
  if (isNaN(latNum) || isNaN(lngNum)) return '';

  const fallback = `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}`;
  const cacheKey = `${latNum.toFixed(2)},${lngNum.toFixed(2)}`;

  if (geoCache.has(cacheKey)) {
    return geoCache.get(cacheKey);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latNum}&lon=${lngNum}&zoom=14`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'EAMS-Attendance-System/1.0 (info@eams.local)'
      }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.display_name) {
        // Build concise address (city, state, country)
        const addr = data.address || {};
        const parts = [
          addr.suburb || addr.neighbourhood || addr.road,
          addr.city || addr.town || addr.village || addr.county,
          addr.state,
          addr.country
        ].filter(Boolean);
        const resolved = parts.length > 0 ? parts.join(', ') : data.display_name;

        if (geoCache.size >= MAX_CACHE_SIZE) {
          const oldestKey = geoCache.keys().next().value;
          geoCache.delete(oldestKey);
        }
        geoCache.set(cacheKey, resolved);
        return resolved;
      }
    }
  } catch (err) {
    // Network error or timeout — fallback to coordinates
  }

  return fallback;
}


module.exports = { reverseGeocode };
