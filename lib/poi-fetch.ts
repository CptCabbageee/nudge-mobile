import { isValidLatLng } from './map-poi-zoom'

/**
 * Nearby POIs via sequential Nominatim bounded searches per category (rate-limited delays between calls).
 */

export type PoiFetchProgressInfo = {
  completedSteps: number
  totalSteps: number
  isRunning: boolean
}

export type MapPoi = {
  key: string
  lat: number
  lng: number
  label: string
  category: string
  displayKey: string
}

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_USER_AGENT = 'Nudge/1.0'

/** filterCategory = map filter (🚂 Transport); displayEmoji = marker/cluster glyph. */
export const NOMINATIM_POI_QUERIES: { q: string; filterCategory: string; displayEmoji: string }[] = [
  { q: 'pub', filterCategory: '🍺', displayEmoji: '🍺' },
  { q: 'restaurant', filterCategory: '🍽️', displayEmoji: '🍽️' },
  { q: 'cafe', filterCategory: '🍽️', displayEmoji: '🍽️' },
  { q: 'supermarket', filterCategory: '🛒', displayEmoji: '🛒' },
  { q: 'convenience store', filterCategory: '🛒', displayEmoji: '🛒' },
  { q: 'clothes shop', filterCategory: '🛒', displayEmoji: '🛒' },
  { q: 'bakery', filterCategory: '🛒', displayEmoji: '🛒' },
  { q: 'off licence', filterCategory: '🛒', displayEmoji: '🛒' },
  { q: 'post office', filterCategory: '📦', displayEmoji: '📦' },
  { q: 'pharmacy', filterCategory: '💊', displayEmoji: '💊' },
  { q: 'bank', filterCategory: '🏦', displayEmoji: '🏦' },
  { q: 'train station', filterCategory: '🚂', displayEmoji: '🚂' },
  { q: 'bus station', filterCategory: '🚂', displayEmoji: '🚂' },
  { q: 'airport', filterCategory: '🚂', displayEmoji: '✈️' },
  { q: 'ferry terminal', filterCategory: '🚂', displayEmoji: '🚢' },
  { q: 'taxi', filterCategory: '🚂', displayEmoji: '🚖' },
  { q: 'parking', filterCategory: '🚗', displayEmoji: '🚗' },
]

/** One Nominatim request per entry; sequential with delay between calls (rate limit). */
export const POI_FETCH_TOTAL = NOMINATIM_POI_QUERIES.length
export const POI_FETCH_DELAY_MS = 1100
export const POI_REFETCH_MIN_DISTANCE_M = 500
const POI_SKIP_NEAR_NUDGE_M = 20

/** ~0.09° ≈ 6–10 km half-span at UK lat — larger area for more POI hits. */
const VIEWBOX_HALF_DEG = 0.09

function nominatimPoiSearchUrl(lat: number, lon: number, q: string, limit: number): string {
  const d = VIEWBOX_HALF_DEG
  const viewbox = `${lon - d},${lat + d},${lon + d},${lat - d}`
  const params = new URLSearchParams({
    q,
    lat: String(lat),
    lon: String(lon),
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
    bounded: '1',
    viewbox,
    extratags: '1',
  })
  return `${NOMINATIM_SEARCH}?${params.toString()}`
}

/** Prefer OSM tags so railway/bus_station never inherit parking from the text query. */
function nominatimPoiCategoryFromOsmItem(item: Record<string, unknown>): {
  filterCategory: string
  displayEmoji: string
} | null {
  const cls = String(item.class ?? '')
  const typ = String(item.type ?? '')
  const ext = (item.extratags as Record<string, string> | undefined) ?? {}
  const railway = ext.railway
  const amenity = ext.amenity

  if (cls === 'railway' && (typ === 'station' || typ === 'halt' || typ === 'tram_stop')) {
    return { filterCategory: '🚂', displayEmoji: '🚂' }
  }
  if (railway === 'station' || railway === 'halt') {
    return { filterCategory: '🚂', displayEmoji: '🚂' }
  }

  if (cls === 'amenity' && typ === 'bus_station') {
    return { filterCategory: '🚂', displayEmoji: '🚂' }
  }
  if (amenity === 'bus_station') {
    return { filterCategory: '🚂', displayEmoji: '🚂' }
  }

  if (cls === 'building' && typ === 'train_station') {
    return { filterCategory: '🚂', displayEmoji: '🚂' }
  }

  if (cls === 'amenity' && typ === 'parking') {
    return { filterCategory: '🚗', displayEmoji: '🚗' }
  }
  if (amenity === 'parking') {
    return { filterCategory: '🚗', displayEmoji: '🚗' }
  }

  return null
}

export function poiTooCloseToAnyNudge(
  latEl: number,
  lonEl: number,
  nudgeCoords: { lat: number; lng: number }[],
): boolean {
  for (const n of nudgeCoords) {
    const dLat = (latEl - n.lat) * 111_000
    const dLng = (lonEl - n.lng) * 111_000 * Math.cos((latEl * Math.PI) / 180)
    const d = Math.sqrt(dLat * dLat + dLng * dLng)
    if (d <= POI_SKIP_NEAR_NUDGE_M) return true
  }
  return false
}

/** Re-apply near-nudge exclusion when serving cached POIs after nudges change. */
export function filterPoisAwayFromNudges(
  pois: MapPoi[],
  nudgeCoords: { lat: number; lng: number }[],
): MapPoi[] {
  if (nudgeCoords.length === 0) return pois
  return pois.filter((p) => !poiTooCloseToAnyNudge(p.lat, p.lng, nudgeCoords))
}

function parseBatch(
  data: any[],
  queryFilter: string,
  queryDisplay: string,
  seen: Set<string>,
  nudgeCoords: { lat: number; lng: number }[],
): MapPoi[] {
  const batch: MapPoi[] = []
  for (const item of data) {
    const latEl = parseFloat(item.lat)
    const lonEl = parseFloat(item.lon)
    if (Number.isNaN(latEl) || Number.isNaN(lonEl)) continue
    const dedupeKey =
      item.osm_type && item.osm_id != null
        ? `${item.osm_type}/${item.osm_id}`
        : item.place_id != null
          ? `place/${item.place_id}`
          : `${latEl.toFixed(5)},${lonEl.toFixed(5)}`
    if (seen.has(dedupeKey)) continue
    if (poiTooCloseToAnyNudge(latEl, lonEl, nudgeCoords)) continue
    seen.add(dedupeKey)
    const fromOsm = nominatimPoiCategoryFromOsmItem(item)
    const filterCategory = fromOsm?.filterCategory ?? queryFilter
    const displayEmoji = fromOsm?.displayEmoji ?? queryDisplay
    const displayName = item.display_name || 'POI'
    batch.push({
      key: `${dedupeKey}/${filterCategory}/${displayEmoji}`,
      lat: latEl,
      lng: lonEl,
      label: displayName || 'POI',
      category: filterCategory,
      displayKey: displayEmoji,
    })
  }
  return batch
}

let poiFetchRunSerial = 0

/**
 * Fetches POIs via sequential Nominatim queries. Calls `onProgress` after each step; calls `onBatch`
 * once at the end with the full accumulated list (avoids N state updates per run). Never rejects.
 */
export async function fetchNearbyPoisSequential(
  lat: number,
  lng: number,
  nudgeCoords: { lat: number; lng: number }[],
  signal: AbortSignal,
  onProgress: ((info: PoiFetchProgressInfo) => void) | undefined,
  onBatch: (batch: MapPoi[]) => void,
  onComplete?: (lat: number, lng: number) => void,
  perQueryLimit = 50,
): Promise<void> {
  const runId = ++poiFetchRunSerial
  const totalSteps = POI_FETCH_TOTAL

  const report = (completedSteps: number, isRunning: boolean) => {
    if (!onProgress) return
    try {
      onProgress({ completedSteps, totalSteps, isRunning })
    } catch {
      /* ignore */
    }
  }

  if (!isValidLatLng(lat, lng)) {
    report(0, false)
    return
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  try {
    report(0, true)

    const seen = new Set<string>()
    let accumulated: MapPoi[] = []

    for (let i = 0; i < NOMINATIM_POI_QUERIES.length; i++) {
      if (signal.aborted) break
      if (runId !== poiFetchRunSerial) break

      if (i > 0) {
        await sleep(POI_FETCH_DELAY_MS)
      }
      if (signal.aborted || runId !== poiFetchRunSerial) break

      const { q, filterCategory, displayEmoji } = NOMINATIM_POI_QUERIES[i]
      const url = nominatimPoiSearchUrl(lat, lng, q, perQueryLimit)

      let batch: MapPoi[] = []
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': NOMINATIM_USER_AGENT },
          signal,
        })
        if (!res.ok) continue
        const parsed: unknown = await res.json().catch(() => [])
        const arr = Array.isArray(parsed) ? parsed : []
        batch = parseBatch(arr, filterCategory, displayEmoji, seen, nudgeCoords)
      } catch {
        /* step failed; continue sequence */
      }

      if (signal.aborted || runId !== poiFetchRunSerial) break

      accumulated = [...accumulated, ...batch]

      const done = i + 1
      const stillRunning = done < totalSteps && !signal.aborted && runId === poiFetchRunSerial
      report(done, stillRunning)
    }

    if (!signal.aborted && runId === poiFetchRunSerial) {
      try {
        onBatch(accumulated)
      } catch {
        /* ignore */
      }
      try {
        onComplete?.(lat, lng)
      } catch {
        /* ignore */
      }
    }
    report(totalSteps, false)
  } catch {
    report(totalSteps, false)
  }
}
