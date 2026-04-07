import { isValidLatLng } from './map-poi-zoom'

/**
 * Nearby POIs via a single Overpass API request.
 */

let lastOverpassCallMs = 0

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

const OVERPASS_API = 'https://overpass-api.de/api/interpreter'

/** filterCategory = map filter (🚂 Transport); displayEmoji = marker/cluster glyph. */
export const POI_QUERIES: { tags: string[]; filterCategory: string; displayEmoji: string }[] = [
  { tags: ['amenity=pub'], filterCategory: '🍺', displayEmoji: '🍺' },
  { tags: ['amenity=restaurant'], filterCategory: '🍽️', displayEmoji: '🍽️' },
  { tags: ['amenity=cafe'], filterCategory: '🍽️', displayEmoji: '🍽️' },
  { tags: ['shop=supermarket'], filterCategory: '🛒', displayEmoji: '🛒' },
  { tags: ['shop=convenience'], filterCategory: '🛒', displayEmoji: '🛒' },
  { tags: ['shop=clothes'], filterCategory: '🛒', displayEmoji: '🛒' },
  { tags: ['shop=bakery'], filterCategory: '🛒', displayEmoji: '🛒' },
  { tags: ['amenity=post_office'], filterCategory: '📦', displayEmoji: '📦' },
  { tags: ['amenity=pharmacy'], filterCategory: '💊', displayEmoji: '💊' },
  { tags: ['amenity=bank'], filterCategory: '🏦', displayEmoji: '🏦' },
  { tags: ['railway=station'], filterCategory: '🚂', displayEmoji: '🚂' },
  { tags: ['amenity=bus_station'], filterCategory: '🚂', displayEmoji: '🚂' },
  { tags: ['amenity=parking'], filterCategory: '🚗', displayEmoji: '🚗' },
]

export const POI_FETCH_TOTAL = POI_QUERIES.length
export const POI_FETCH_DELAY_MS = 300
/** Abort the HTTP request so a hung request cannot leave the map stuck on "Loading nearby places…". */
const POI_FETCH_REQUEST_TIMEOUT_MS = 18_000

function buildOverpassQuery(lat: number, lng: number, tags: string[]): string {
  const radius = 1000 // metres
  const tagFilters = tags.map(t => {
    const [k, v] = t.split('=')
    return v ? `node["${k}"="${v}"](around:${radius},${lat},${lng});` : `node["${k}"](around:${radius},${lat},${lng});`
  }).join('\n')
  return `[out:json][timeout:25];\n(\n${tagFilters}\n);\nout body;`
}

function categoryFromTags(tags: Record<string, string>): { filterCategory: string; displayEmoji: string } | null {
  if (tags.amenity === 'pub') return { filterCategory: '🍺', displayEmoji: '🍺' }
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe') return { filterCategory: '🍽️', displayEmoji: '🍽️' }
  if (tags.shop === 'supermarket' || tags.shop === 'convenience' || tags.shop === 'clothes' || tags.shop === 'bakery') return { filterCategory: '🛒', displayEmoji: '🛒' }
  if (tags.amenity === 'post_office') return { filterCategory: '📦', displayEmoji: '📦' }
  if (tags.amenity === 'pharmacy') return { filterCategory: '💊', displayEmoji: '💊' }
  if (tags.amenity === 'bank') return { filterCategory: '🏦', displayEmoji: '🏦' }
  if (tags.railway === 'station') return { filterCategory: '🚂', displayEmoji: '🚂' }
  if (tags.amenity === 'bus_station') return { filterCategory: '🚂', displayEmoji: '🚂' }
  if (tags.amenity === 'parking') return { filterCategory: '🚗', displayEmoji: '🚗' }
  return null
}

function perRequestAbort(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const child = new AbortController()
  let tid: ReturnType<typeof setTimeout> | undefined
  const clearTimer = () => {
    if (tid !== undefined) {
      clearTimeout(tid)
      tid = undefined
    }
  }
  const finish = () => {
    clearTimer()
    parent.removeEventListener('abort', onParent)
    if (!child.signal.aborted) {
      try {
        child.abort()
      } catch {
        /* ignore */
      }
    }
  }
  const onParent = () => finish()
  if (parent.aborted) {
    try {
      child.abort()
    } catch {
      /* ignore */
    }
    return { signal: child.signal, cancel: () => {} }
  }
  parent.addEventListener('abort', onParent)
  tid = setTimeout(finish, timeoutMs)
  return { signal: child.signal, cancel: finish }
}

export const POI_REFETCH_MIN_DISTANCE_M = 500
const POI_SKIP_NEAR_NUDGE_M = 20

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
    const displayName = item.display_name || 'POI'
    batch.push({
      key: `${dedupeKey}/${queryFilter}/${queryDisplay}`,
      lat: latEl,
      lng: lonEl,
      label: displayName || 'POI',
      category: queryFilter,
      displayKey: queryDisplay,
    })
  }
  return batch
}

/**
 * Fetches POIs via a single Overpass API request for all POI types.
 * Calls `onProgress` at start and end; calls `onBatch` once with all results. Never rejects.
 */
export async function fetchNearbyPoisSequential(
  lat: number,
  lng: number,
  nudgeCoords: { lat: number; lng: number }[],
  signal: AbortSignal,
  onProgress: ((info: PoiFetchProgressInfo) => void) | undefined,
  onBatch: (batch: MapPoi[]) => void,
  /** Called once when the fetch finishes; includes final accumulated list. */
  onComplete?: (lat: number, lng: number, accumulated: MapPoi[]) => void,
  _perQueryLimit = 50,
): Promise<void> {
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
    try {
      onComplete?.(lat, lng, [])
    } catch {
      /* ignore */
    }
    return
  }

  try {
    report(0, true)

    if (signal.aborted) {
      report(totalSteps, false)
      return
    }

    if (Date.now() - lastOverpassCallMs < 3000) {
      report(totalSteps, false)
      return
    }

    const allTags = POI_QUERIES.flatMap((q) => q.tags)
    const query = buildOverpassQuery(lat, lng, allTags)

    const seen = new Set<string>()
    let accumulated: MapPoi[] = []

    const { signal: stepSignal, cancel: cancelStep } = perRequestAbort(signal, POI_FETCH_REQUEST_TIMEOUT_MS)
    lastOverpassCallMs = Date.now()
    try {
      const res = await fetch(OVERPASS_API, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: stepSignal,
      })
      if (res.ok) {
        const parsed: unknown = await res.json().catch(() => ({}))
        const elements: any[] = Array.isArray((parsed as any)?.elements) ? (parsed as any).elements : []
        for (const element of elements) {
          if (signal.aborted) break
          const latEl = element.lat as number
          const lonEl = element.lon as number
          if (!Number.isFinite(latEl) || !Number.isFinite(lonEl)) continue
          const dedupeKey = `${element.type ?? 'node'}/${element.id}`
          if (seen.has(dedupeKey)) continue
          if (poiTooCloseToAnyNudge(latEl, lonEl, nudgeCoords)) continue
          seen.add(dedupeKey)
          const tags: Record<string, string> = element.tags ?? {}
          const cat = categoryFromTags(tags)
          if (!cat) continue
          const name = tags.name || cat.displayEmoji
          accumulated.push({
            key: `${dedupeKey}/${cat.filterCategory}/${cat.displayEmoji}`,
            lat: latEl,
            lng: lonEl,
            label: name,
            category: cat.filterCategory,
            displayKey: cat.displayEmoji,
          })
        }
      }
    } catch {
      /* fetch failed; accumulated stays empty */
    } finally {
      cancelStep()
    }

    if (!signal.aborted) {
      if (accumulated.length > 0) {
        try {
          onBatch(accumulated)
        } catch {
          /* ignore */
        }
      }
      try {
        onComplete?.(lat, lng, accumulated)
      } catch {
        /* ignore */
      }
    }
    report(totalSteps, false)
  } catch {
    report(totalSteps, false)
  }
}
