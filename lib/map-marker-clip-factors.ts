import { Platform } from 'react-native'

/**
 * Why custom Map Marker children look clipped (especially on Android / Google Maps):
 *
 * 1. **Bitmap snapshot** — The native map rasterizes the React child view. The texture size follows
 *    **layout bounds**, not painted overflow. `overflow: 'visible'` does **not** expand the snapshot.
 *    VERDICT: True — pad with a larger explicit wrapper so the full shape + border fits inside layout.
 *
 * 2. **centerOffset on Android** — `MapMarker.d.ts` documents `centerOffset` as Apple Maps only; for
 *    Google Maps use `anchor`. On Android, centerOffset is not the supported API.
 *    VERDICT: Likely culprit if we relied on centerOffset for positioning — use anchor + symmetric frame.
 *
 * 3. **borderRadius + borderWidth** — Rounded rects with strokes can render as arcs/crescents in the
 *    map’s texture path.
 *    VERDICT: Often true on Android — optional: drop stroke on map-only views or use more padding.
 *
 * 4. **Text textShadowRadius** — Shadow draws outside the text’s layout box and can be cut by the snapshot.
 *    VERDICT: Possible on cluster pills — omit text shadow on Android for marker labels.
 *
 * 5. **Anchor vs. content size** — Mismatch shows one quadrant of the view.
 *    VERDICT: True — use anchor (0.5, 0.5) with a square, centered content.
 *
 * 6. **MapView / parent overflow** — Map markers are native overlays; parent `overflow: hidden` on RN
 *    chrome does not clip marker bitmaps.
 *    VERDICT: Usually false for clipping *inside* the marker icon itself.
 *
 * 7. **tracksViewChanges** — Snapshot taken before layout → empty or partial bitmap.
 *    VERDICT: Can happen — Android custom markers keep tracking on in our map screen.
 */

export const MAP_MARKER_CLIP_FACTOR_SUMMARY = [
  'snapshot uses layout bounds only (not overflow:visible)',
  'Android: use anchor, not centerOffset (per react-native-maps types)',
  'borderRadius+borderWidth texture artifacts',
  'textShadow outside text layout clipped',
  'anchor mismatch → partial quadrant',
  'MapView overflow unrelated to marker bitmap',
  'tracksViewChanges timing',
] as const

let logged = false

/** One-shot __DEV__ console checklist (no PII). */
export function logMapMarkerClipDiagnosticsOnce(): void {
  if (!__DEV__ || logged) return
  logged = true
  if (Platform.OS !== 'android') return
  console.log(
    '[map marker clip] Android Google Maps — factors checked:\n',
    MAP_MARKER_CLIP_FACTOR_SUMMARY.map((s, i) => `  ${i + 1}. ${s}`).join('\n'),
  )
}

/**
 * Why POI pins can look *more* clipped after tightening layout (regression diagnostics).
 *
 * A. **Undersized snapshot frame** — Nudge markers used 72×72; POI used 52×52. Vector icons (Ionicons)
 *    anti-alias past their nominal box; border adds 2×borderWidth to outer diameter. Safe margin should
 *    match or exceed the nudge case (~14px radius slack on each side for a 40px disc → 72 frame).
 *    For 24px + 2px border → 28px; slack (52−28)/2 = 12px may be insufficient on some densities.
 *
 * B. **borderWidth + borderRadius at small dp** — Same as (3) above but worse on a 24dp circle: stroke
 *    often rasterizes as a partial arc inside the map texture.
 *
 * C. **centerOffset removal** — If centerOffset was ignored on Android, removing it should not worsen
 *    clipping; if a fork behaved differently, anchor-only is still correct per types — frame/texture
 *    issues are the likelier regression.
 *
 * D. **Icon font glyph overflow** — CategoryIcon uses Ionicons; glyphs can exceed the inner View’s
 *    layout box slightly; snapshot clips to parent 52×52.
 */
export const POI_MARKER_REGRESSION_NOTES = [
  'A: POI frame 52 < nudge frame 72 → insufficient slack for AA + border + icon overshoot',
  'B: 1px stroke on 24dp circle → common crescent/half-moon in map bitmap',
  'C: centerOffset removal unlikely root if types say unsupported on Android Google Maps',
  'D: Ionicons draw outside tight inner bounds → clip at fixed outer width/height',
] as const

let poiRegressionLogged = false

/** __DEV__ once: explains likely causes when POI clipping got worse after layout changes. */
export function logPoiMarkerClipRegressionOnce(): void {
  if (!__DEV__ || poiRegressionLogged) return
  poiRegressionLogged = true
  if (Platform.OS !== 'android') return
  console.log('[POI marker clip regression] Hypotheses (see map-marker-clip-factors.ts):\n')
  POI_MARKER_REGRESSION_NOTES.forEach((line) => console.log(`  ${line}`))
}
