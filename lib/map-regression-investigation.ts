/**
 * Investigation: “No POIs”, “most nudges missing”, “more clipping” after marker layout changes.
 * No runtime behavior — documentation only. See app/(tabs)/index.tsx for cited line behavior.
 *
 * -----------------------------------------------------------------------------
 * 1. NO POI MARKERS AT ALL
 * -----------------------------------------------------------------------------
 * POIs are only mounted when `poiMarkersVisible` is true (index ~1103). That flag is
 * `spanShowsPoiMarkers(mapSpanForClustering)` (~782–785), i.e. visible only when
 * mapSpanForClustering < POI_MARKERS_MAX_LATITUDE_DELTA (0.1° in map-poi-zoom.ts).
 * If the map reports span ≥ 0.1 on region complete, the POI layer is not rendered at all
 * even if `pois` state is non-empty — looks like “no POI markers”.
 *
 * Separately, `pois` may stay [] if foreground fetch never completes (aborts only) or onBatch
 * never sees accumulated.length > 0 mid-run. Foreground `finalize` now always applyPoisBatch on
 * successful completion (including []). Silent refresh only applies when filtered.length > 0.
 * - `fetchNearbyPoisSequential` only invokes onBatch when accumulated.length > 0 after a step.
 * - Rapid abort before any step adds data → no onBatch → [] remains.
 *
 * Marker view styling (frame 72, elevation, anchor) does not modify `pois` or `poiMarkersVisible`.
 *
 * -----------------------------------------------------------------------------
 * 2. MOST NUDGES “NOT LOADING” ON THE MAP
 * -----------------------------------------------------------------------------
 * Nudges are not “loaded” per marker — they come from `nudgesOnMap` (~748–756), which filters
 * `nudges` by activeCategories.has(n.category ?? '⭐'). If the chip row has only a subset of
 * categories on (e.g. Shopping + Pub), most nudges are excluded by design — not a fetch failure.
 *
 * Other factors:
 * - MapNudgeMarker uses tracksViewChanges={true} on Android (~183). With many markers, native
 *   sync cost can cause missing/delayed draws (performance), not data loss.
 * - Ionicons/font issues: CategoryIcon would show empty or error; would not remove Marker nodes.
 *
 * -----------------------------------------------------------------------------
 * 3. MORE CLIPPING
 * -----------------------------------------------------------------------------
 * Google Maps rasterizes Marker children to a texture bounded by layout, not overflow:visible.
 * Changes that can worsen perceived clipping:
 * - elevation on POI/cluster Android views: shadows draw outside layout; snapshot may clip them,
 *   making the pin look “eaten” or irregular vs a flat bordered circle.
 * - Larger outer frame without fixing native anchor/bitmap quirks can still crop incorrectly.
 * - borderWidth + borderRadius on nudge (unchanged 2px on 40dp) still prone to arc artifacts.
 *
 * -----------------------------------------------------------------------------
 * 4. WHAT DID NOT CAUSE DATA LOSS (by code inspection)
 * -----------------------------------------------------------------------------
 * - POI: No recent change ties Marker layout to setPois([]) except intentional zoom-out abort
 *   path (which does not clear pois anymore).
 * - Nudges: No change to fetchUserNudges or nudges state from marker components.
 */

export const MAP_REGRESSION_INVESTIGATION_REF = 'lib/map-regression-investigation.ts'
