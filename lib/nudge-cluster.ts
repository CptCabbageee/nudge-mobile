import type { NudgeListItem } from './nudge-queries'
import {
  haversineMeters,
  POI_CLUSTER_MERGE_ALL_SPAN_DEG,
  POI_CLUSTER_RADIUS_LERP_MAX_SPAN,
  POI_CLUSTER_RADIUS_METERS_FAR_CAP,
  POI_CLUSTER_RADIUS_METERS_NEAR,
} from './poi-cluster'

const SPAN_FOR_RADIUS_LERP = { min: 0.004, max: POI_CLUSTER_RADIUS_LERP_MAX_SPAN }

function clusterRadiusMetersForSpan(mapSpanDeg: number): number {
  const { min, max } = SPAN_FOR_RADIUS_LERP
  if (mapSpanDeg <= min) return POI_CLUSTER_RADIUS_METERS_NEAR
  const t = Math.max(0, Math.min(1, (mapSpanDeg - min) / (max - min)))
  return POI_CLUSTER_RADIUS_METERS_NEAR + t * (POI_CLUSTER_RADIUS_METERS_FAR_CAP - POI_CLUSTER_RADIUS_METERS_NEAR)
}

function floodFillNudges(
  nudges: NudgeListItem[],
  startGlobal: number,
  assigned: Set<number>,
  clusterRadiusMeters: number,
): NudgeListItem[] {
  const members: NudgeListItem[] = []
  const stack: number[] = [startGlobal]
  assigned.add(startGlobal)

  while (stack.length > 0) {
    const gi = stack.pop()!
    const ni = nudges[gi]
    members.push(ni)

    for (let j = 0; j < nudges.length; j++) {
      if (assigned.has(j)) continue
      const nj = nudges[j]
      if (
        haversineMeters({ lat: ni.lat, lng: ni.lng }, { lat: nj.lat, lng: nj.lng }) <= clusterRadiusMeters
      ) {
        assigned.add(j)
        stack.push(j)
      }
    }
  }

  return members
}

export type NudgeClusterRenderItem =
  | { kind: 'single'; nudge: NudgeListItem }
  | { kind: 'cluster'; key: string; members: NudgeListItem[]; centerLat: number; centerLng: number }

/**
 * Geographic clustering for nudges (same span/radius behaviour as {@link clusterMapPois}).
 * POI and nudge layers cluster independently.
 */
export function clusterMapNudges(nudges: NudgeListItem[], mapSpanDeg: number): NudgeClusterRenderItem[] {
  if (nudges.length === 0) {
    return []
  }

  if (mapSpanDeg >= POI_CLUSTER_MERGE_ALL_SPAN_DEG) {
    if (nudges.length === 1) {
      return [{ kind: 'single', nudge: nudges[0] }]
    }
    const centerLat = nudges.reduce((s, n) => s + n.lat, 0) / nudges.length
    const centerLng = nudges.reduce((s, n) => s + n.lng, 0) / nudges.length
    const key = `ncl-all-${nudges
      .map((n) => n.id)
      .sort()
      .join('|')}`
    return [{ kind: 'cluster', key, members: nudges, centerLat, centerLng }]
  }

  const clusterRadiusMeters = clusterRadiusMetersForSpan(mapSpanDeg)
  const assigned = new Set<number>()
  const out: NudgeClusterRenderItem[] = []

  for (let i = 0; i < nudges.length; i++) {
    if (assigned.has(i)) continue
    const members = floodFillNudges(nudges, i, assigned, clusterRadiusMeters)

    if (members.length === 1) {
      out.push({ kind: 'single', nudge: members[0] })
    } else {
      const centerLat = members.reduce((s, n) => s + n.lat, 0) / members.length
      const centerLng = members.reduce((s, n) => s + n.lng, 0) / members.length
      const key = `ncl-${members
        .map((n) => n.id)
        .sort()
        .join('|')}`
      out.push({ kind: 'cluster', key, members, centerLat, centerLng })
    }
  }

  return out
}
