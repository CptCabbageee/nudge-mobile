import type { MapPoi } from './poi-fetch'

/** Cluster radius: POIs within this distance merge into one pill (all categories). */
const CLUSTER_RADIUS_METERS = 250

export type PoiClusterRenderItem =
  | { kind: 'single'; key: string; poi: MapPoi }
  | { kind: 'cluster'; key: string; members: MapPoi[]; centerLat: number; centerLng: number }

type LatLng = { lat: number; lng: number }

/** Haversine great-circle distance in metres (WGS84 sphere, R = 6371000 m). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)))
  return R * c
}

const MAX_CATEGORY_ICONS = 3

export type CategoryCountRow = { category: string; count: number }

/** Categories in a cluster sorted by count descending (for pill icons). */
export function getClusterCategoryRows(members: MapPoi[]): CategoryCountRow[] {
  const m = new Map<string, number>()
  for (const p of members) {
    const c = (p.category ?? '').trim() || '⭐'
    m.set(c, (m.get(c) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

/** First {@link MAX_CATEGORY_ICONS} category rows and how many additional category types exist. */
export function getClusterPillCategories(rows: CategoryCountRow[]): {
  top: CategoryCountRow[]
  moreCategoryTypes: number
} {
  return {
    top: rows.slice(0, MAX_CATEGORY_ICONS),
    moreCategoryTypes: Math.max(0, rows.length - MAX_CATEGORY_ICONS),
  }
}

function floodFillGeographic(pois: MapPoi[], startGlobal: number, assigned: Set<number>): MapPoi[] {
  const members: MapPoi[] = []
  const stack: number[] = [startGlobal]
  assigned.add(startGlobal)

  while (stack.length > 0) {
    const gi = stack.pop()!
    const pi = pois[gi]
    members.push(pi)

    for (let j = 0; j < pois.length; j++) {
      if (assigned.has(j)) continue
      const pj = pois[j]
      if (
        haversineMeters({ lat: pi.lat, lng: pi.lng }, { lat: pj.lat, lng: pj.lng }) <= CLUSTER_RADIUS_METERS
      ) {
        assigned.add(j)
        stack.push(j)
      }
    }
  }

  return members
}

/**
 * Geographic clustering: POIs within {@link CLUSTER_RADIUS_METERS} merge into one pill (any mix of categories).
 */
export function clusterMapPois(pois: MapPoi[]): PoiClusterRenderItem[] {
  if (pois.length === 0) {
    return []
  }

  const assigned = new Set<number>()
  const out: PoiClusterRenderItem[] = []

  for (let i = 0; i < pois.length; i++) {
    if (assigned.has(i)) continue
    const members = floodFillGeographic(pois, i, assigned)

    if (members.length === 1) {
      out.push({ kind: 'single', key: members[0].key, poi: members[0] })
    } else {
      const centerLat = members.reduce((s, m) => s + m.lat, 0) / members.length
      const centerLng = members.reduce((s, m) => s + m.lng, 0) / members.length
      const key = `cl-${members
        .map((m) => m.key)
        .sort()
        .join('|')}`
      out.push({ kind: 'cluster', key, members, centerLat, centerLng })
    }
  }

  return out
}
