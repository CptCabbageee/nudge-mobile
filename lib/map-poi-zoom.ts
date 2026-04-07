type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }

/**
 * POI fetch + pins are skipped when span is larger than this. 0.22 was too tight — a normal
 * “county” view (~0.25–0.45°) never fetched OSM POIs, so the map looked empty of place pins.
 */
export const POI_MARKERS_MAX_LATITUDE_DELTA = 0.55

/** Use the larger of lat/lng delta so wide aspect ratios still require zoom-in. */
export function regionShowsPoiMarkers(region: Region | null | undefined): boolean {
  if (!region) return false
  const span = Math.max(region.latitudeDelta, region.longitudeDelta)
  return span < POI_MARKERS_MAX_LATITUDE_DELTA
}

/** Same rule as {@link regionShowsPoiMarkers} using a precomputed span (e.g. from `mapSpanForClustering`). */
export function spanShowsPoiMarkers(spanDeg: number): boolean {
  return Number.isFinite(spanDeg) && spanDeg < POI_MARKERS_MAX_LATITUDE_DELTA
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
