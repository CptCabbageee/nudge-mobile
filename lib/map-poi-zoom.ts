import type { Region } from 'react-native-maps'

/**
 * POI markers are hidden when the visible span is larger than this (zoomed out),
 * to avoid clutter. Smaller `latitudeDelta` = more zoomed in.
 * ~0.017° latitude ≈ 1.9 km — roughly “neighbourhood” level and above.
 */
export const POI_MARKERS_MAX_LATITUDE_DELTA = 0.08

/** Use the larger of lat/lng delta so wide aspect ratios still require zoom-in. */
export function regionShowsPoiMarkers(region: Region | null | undefined): boolean {
  if (!region) return false
  const span = Math.max(region.latitudeDelta, region.longitudeDelta)
  return span < POI_MARKERS_MAX_LATITUDE_DELTA
}

/** Finite WGS84 point suitable for geo API requests. */
export function isValidLatLng(lat: number, lng: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat < -90 || lat > 90) return false
  if (lng < -180 || lng > 180) return false
  return true
}

/** Map region is safe to use as a fetch centre (centre + span). */
export function isValidMapRegionForFetch(region: Region | null | undefined): boolean {
  if (!region) return false
  if (!isValidLatLng(region.latitude, region.longitude)) return false
  const { latitudeDelta, longitudeDelta } = region
  if (!Number.isFinite(latitudeDelta) || !Number.isFinite(longitudeDelta)) return false
  if (latitudeDelta <= 0 || longitudeDelta <= 0) return false
  return true
}
