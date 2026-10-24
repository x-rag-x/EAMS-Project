const { getSettings } = require('./settingsCache');

/**
 * Earth radius in meters
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculate Haversine distance between two GPS coordinates in meters.
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in meters
 */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Verify whether a coordinate falls inside the campus geofence.
 *
 * @param {Object} params
 * @param {number|null} params.lat
 * @param {number|null} params.lng
 * @param {string} [params.geoStatus] - 'denied' if user refused location sharing
 * @param {Object} [params.customGeofence] - Optional { lat, lng, radiusM }
 * @returns {Promise<{ status: 'ok'|'outside'|'denied', inside: boolean, distanceM: number|null, radiusM: number }>}
 */
async function verifyCampusGeofence({ lat, lng, geoStatus = null, customGeofence = null }) {
  if (geoStatus === 'denied' || lat === null || lat === undefined || lng === null || lng === undefined) {
    return {
      status: 'denied',
      inside: false,
      distanceM: null,
      radiusM: 400
    };
  }

  let fence = customGeofence;
  if (!fence) {
    const settings = await getSettings(['controller']);
    fence = settings.controller?.campusGeofence || { lat: null, lng: null, radiusM: 400 };
  }

  const radiusM = Number(fence.radiusM) || 400;

  // If campus geofence coordinates are not configured yet, permit by default
  if (!fence.lat || !fence.lng) {
    return {
      status: 'ok',
      inside: true,
      distanceM: 0,
      radiusM,
      unconfigured: true
    };
  }

  const dist = haversineDistanceMeters(
    Number(lat),
    Number(lng),
    Number(fence.lat),
    Number(fence.lng)
  );

  const inside = dist <= radiusM;
  return {
    status: inside ? 'ok' : 'outside',
    inside,
    distanceM: Math.round(dist),
    radiusM
  };
}

module.exports = {
  haversineDistanceMeters,
  verifyCampusGeofence
};
