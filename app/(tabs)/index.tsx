import { Ionicons } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import * as Location from 'expo-location'
import Slider from '@react-native-community/slider'
import type { User } from '@supabase/supabase-js'
import { useIsFocused } from '@react-navigation/native'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  Map as MapLibreMap,
  Camera,
  type CameraRef,
  type MapRef,
  GeoJSONSource,
  Layer,
  Marker,
} from '@maplibre/maplibre-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HomeLocationGateModal, type HomeDraft } from '../../components/HomeLocationGateModal'
import { GooglePlacesAddressSearchField } from '../../components/GooglePlacesAddressSearchField'
import { AppStartupSplash } from '../../components/AppStartupSplash'
import NudgeModal, { type NudgeSavePayload } from '../../components/NudgeModal'
import { NudgeToast } from '../../components/NudgeToast'
import { AppLogo } from '../../components/AppLogo'
import { CategoryIcon } from '../../components/CategoryIcon'
import { useAuth } from '../../context/AuthContext'
import { useLeavingHomePrompt } from '../../context/LeavingHomePromptContext'
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/categories'
import { distanceMetres } from '../../lib/geo'
import { fetchUserHome, upsertUserHome, type UserHomeRow } from '../../lib/home-queries'
import { isValidMapRegionForFetch } from '../../lib/map-poi-zoom'
import { clusterMapNudges, type NudgeClusterRenderItem } from '../../lib/nudge-cluster'
import {
  createLeavingHomeNudgeIfAbsent,
  deleteNudgeForUser,
  fetchUserNudges,
  hasLeavingHomeNudge,
  updateNudgeForUser,
  type NudgeListItem,
} from '../../lib/nudge-queries'
import { loadDefaultRadiusMeters } from '../../lib/user-preferences'
import {
  clearAllPoiAreaCache,
  peekPoiAreaCache,
  poiAreaCacheKey,
  putPoiAreaCache,
  touchAndReadPoiAreaCache,
} from '../../lib/poi-cache-db'
import {
  clusterMapPois,
  getClusterCategoryRows,
  getClusterCategoryRowsFromMembers,
  getClusterPillCategories,
  type PoiClusterRenderItem,
} from '../../lib/poi-cluster'
import {
  fetchNearbyPoisSequential,
  filterPoisAwayFromNudges,
  type MapPoi,
  type PoiFetchProgressInfo,
} from '../../lib/poi-fetch'
import { supabase } from '../../lib/supabase'
import { effectiveUserId } from '../../lib/dev-user'


type Region = {
  latitude: number
  longitude: number
  latitudeDelta: number
  longitudeDelta: number
}

const BG = '#0a0a0a'
const SURFACE = '#141414'
const ACCENT = '#00BFA5'
/** POI pins / clusters — dark blue, distinct from turquoise nudges. */
const POI_MAP_BLUE = '#0f2438'
const MUTED = 'rgba(255,255,255,0.55)'

const MAP_OVERLAY_TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.8)',
  textShadowOffset: { width: 1, height: 1 } as const,
  textShadowRadius: 3,
}

const LOCATION_TIMEOUT_MS = 20_000
const FALLBACK_COORDS = { lat: 51.5074, lng: -0.1278 } // London

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty'
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/fiord'

/** POI refetch only if the map centre has moved this far from {@link lastPoiFetchCenterRef} (onRegionChangeComplete). */
const POI_FETCH_MIN_MOVE_M = 500

/** Avoid publishing `region` to React state on every tiny settle — reduces MapView/marker re-renders. */
const MIN_REGION_PUBLISH_MOVE_M = 80

/** Hide POI pins that fall inside a nudge geofence (+ margin) so one tap target stays the nudge. */
const POI_HIDE_INSIDE_NUDGE_RADIUS_MARGIN_M = 10

function toRegionFromCoords(coords: { lat: number; lng: number }): Region {
  return {
    latitude: coords.lat,
    longitude: coords.lng,
    latitudeDelta: 0.015,
    longitudeDelta: 0.015,
  }
}

/** Approximate conversion from latitudeDelta to MapLibreGL zoom level. */
function latDeltaToZoom(latitudeDelta: number): number {
  return Math.log2(360 / latitudeDelta) - 1
}

/** Create a GeoJSON Polygon Feature approximating a circle in metres. */
function geoCircleFeature(lat: number, lng: number, radiusMeters: number, steps = 64): any {
  const earthRadius = 6371000
  const coords: [number, number][] = []
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    const dLat = ((radiusMeters * Math.cos(angle)) / earthRadius) * (180 / Math.PI)
    const dLng =
      ((radiusMeters * Math.sin(angle)) / (earthRadius * Math.cos((lat * Math.PI) / 180))) *
      (180 / Math.PI)
    coords.push([lng + dLng, lat + dLat])
  }
  coords.push(coords[0])
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }
}

async function getCurrentPositionWithTimeout(timeoutMs: number): Promise<Location.LocationObject | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeoutPromise,
    ])
    return pos
  } catch {
    return null
  }
}

const MapNudgeMarker = memo(({ nudge, onPress }: { nudge: NudgeListItem; onPress: () => void }) => (
  <Marker id={nudge.id} lngLat={[nudge.lng, nudge.lat]} onPress={onPress}>
    <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
      <View collapsable={false} style={styles.nudgePin}>
        <CategoryIcon category={nudge.category || '⭐'} size={18} color={POI_MAP_BLUE} />
      </View>
    </View>
  </Marker>
))

const MapNudgeClusterMarker = memo(({ item, onPress }: { item: Extract<NudgeClusterRenderItem, { kind: 'cluster' }>; onPress: () => void }) => {
  const rows = getClusterCategoryRowsFromMembers(item.members)
  const { top } = getClusterPillCategories(rows)
  return (
    <Marker id={item.key} lngLat={[item.centerLng, item.centerLat]} onPress={onPress}>
      <View collapsable={false} style={styles.nudgeClusterMarkerRoot}>
        <View style={styles.nudgeClusterPill}>
          <View style={styles.nudgeClusterLogoSlot}><AppLogo size={22} /></View>
          <View style={styles.nudgeClusterIcons}>
            {top.map((r) => (
              <View key={r.category} style={styles.nudgeClusterIconSlot}>
                <CategoryIcon category={r.category} size={13} color={POI_MAP_BLUE} />
              </View>
            ))}
          </View>
          <Text style={styles.nudgeClusterCount}>{item.members.length}</Text>
        </View>
      </View>
    </Marker>
  )
})

const MapPoiMarker = memo(({ poi, onPress }: { poi: MapPoi; onPress: () => void }) => (
  <Marker id={poi.key} lngLat={[poi.lng, poi.lat]} onPress={onPress}>
    <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
      <View collapsable={false} style={styles.poiPin}>
        <CategoryIcon category={poi.category} size={17} color={ACCENT} />
      </View>
    </View>
  </Marker>
))

const MapClusterMarker = memo(({ item, onPress }: { item: Extract<PoiClusterRenderItem, { kind: 'cluster' }>; onPress: () => void }) => {
  const rows = getClusterCategoryRows(item.members)
  const { top } = getClusterPillCategories(rows)
  return (
    <Marker id={item.key} lngLat={[item.centerLng, item.centerLat]} onPress={onPress}>
      <View collapsable={false} style={styles.poiClusterMarkerRoot}>
        <View style={styles.poiClusterPill}>
          <View style={styles.poiClusterIcons}>
            {top.map((r) => (
              <View key={r.category} style={styles.poiClusterIconSlot}>
                <CategoryIcon category={r.category} size={13} color={ACCENT} />
              </View>
            ))}
          </View>
          <Text style={styles.poiClusterCount}>{item.members.length}</Text>
        </View>
      </View>
    </Marker>
  )
})

type MapScreenBodyProps = {
  /** Null when auth is bypassed for development. */
  user: User | null
  insets: ReturnType<typeof useSafeAreaInsets>
  initialRegion: Region
  initialUserCoords: { lat: number; lng: number }
  onRefocusRequestLocation: () => void
  openHomeGateOnLoad?: boolean
}

/** All hooks run unconditionally at the top level; no returns before hooks complete. */
function MapScreenBody({
  user,
  insets,
  initialRegion,
  initialUserCoords,
  onRefocusRequestLocation,
  openHomeGateOnLoad,
}: MapScreenBodyProps) {
  const { registerLeavingHomeComposeHandler, invalidateLeavingHomePromptCheck } = useLeavingHomePrompt()
  const isFocused = useIsFocused()

  const [userCoords, setUserCoords] = useState(initialUserCoords)
  const [region, setRegion] = useState<Region>(initialRegion)
  /** Updated on every region change complete (unlike `region` when movement is below publish threshold). */
  const [mapSpanForClustering, setMapSpanForClustering] = useState(
    () => Math.max(initialRegion.latitudeDelta, initialRegion.longitudeDelta),
  )
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(CATEGORIES))
  const [nudges, setNudges] = useState<Awaited<ReturnType<typeof fetchUserNudges>>['data']>([])
  const [homeRow, setHomeRow] = useState<UserHomeRow | null>(null)
  const [nudgeModalOpen, setNudgeModalOpen] = useState(false)
  const [editNudge, setEditNudge] = useState<(typeof nudges)[number] | null>(null)
  const [pendingCreate, setPendingCreate] = useState<{ lat: number; lng: number; title?: string; category?: string } | null>(null)
  const [tapDraft, setTapDraft] = useState<{ lat: number; lng: number; title?: string; category?: string } | null>(null)
  const [nudgeEditPrompt, setNudgeEditPrompt] = useState<(typeof nudges)[number] | null>(null)
  const [radiusMeters, setRadiusMeters] = useState(25)
  const [searchAnchor, setSearchAnchor] = useState<{ lat: number; lng: number } | null>(null)
  const [homeGateOpen, setHomeGateOpen] = useState(false)
  const [homeGateChecked, setHomeGateChecked] = useState(false)
  const openHomeGateOnLoadFiredRef = useRef(false)
  useEffect(() => {
    if (openHomeGateOnLoad && !openHomeGateOnLoadFiredRef.current) {
      openHomeGateOnLoadFiredRef.current = true
      setHomeGateOpen(true)
    }
  }, [])
  const [homeDraft, setHomeDraft] = useState<HomeDraft | null>(null)
  const [homeMapPickActive, setHomeMapPickActive] = useState(false)
  const [homeSaving, setHomeSaving] = useState(false)
  const [pois, setPois] = useState<MapPoi[]>([])
  const poisRef = useRef<MapPoi[]>([])

  const [poiProgress, setPoiProgress] = useState(0)
  /** True from POI fetch start until batch applied or run ends (covers progress 0 steps). */
  const [poiFetchActive, setPoiFetchActive] = useState(false)
  const [isMapCenteredOnUser, setIsMapCenteredOnUser] = useState(true)
  const [hasHomeLeaveNudge, setHasHomeLeaveNudge] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastVisible, setToastVisible] = useState(false)

  const mapRef = useRef<MapRef | null>(null)
  const cameraRef = useRef<CameraRef | null>(null)
  const poiAbortRef = useRef<AbortController | null>(null)
  const mapInitialRegionRef = useRef<Region | null>(null)
  const initialCameraSettingsRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const homeGateDismissedRef = useRef(false)

  const hasDoneInitialPoiFetchRef = useRef(false)
  const hasLoadedInitialNudgesRef = useRef(false)
  /** Last map centre we used to start a POI fetch (onRegionChangeComplete only). */
  const lastPoiFetchCenterRef = useRef<{ lat: number; lng: number } | null>(null)
  /** Last {@link poiAreaCacheKey} we successfully loaded (cache or network). Used with 500 m guard. */
  const lastPoiFetchAreaKeyRef = useRef<string | null>(null)
  const homePoiPrefetchAbortRef = useRef<AbortController | null>(null)
  /** Latest region from onRegionChangeComplete (for nudge-change refetch without depending on `region` state). */
  const stableMapRegionRef = useRef<Region | null>(null)
  /** Last region snapshot written to `region` state (for sparse state updates). */
  const regionPublishedRef = useRef<Region | null>(null)
  const poiProgressEmitRef = useRef({ lastTs: 0 })
  const poiFetchCountRef = useRef(0)
  const nudgeCoordsRef = useRef<{ lat: number; lng: number }[]>([])

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    setToastVisible(true)
  }, [])

  useEffect(() => {
    setUserCoords(initialUserCoords)
  }, [initialUserCoords])
  useEffect(() => {
    setRegion(initialRegion)
    setMapSpanForClustering(Math.max(initialRegion.latitudeDelta, initialRegion.longitudeDelta))
  }, [initialRegion])

  useEffect(() => {
    nudgeCoordsRef.current = nudges.map((n) => ({ lat: n.lat, lng: n.lng }))
  }, [nudges])

  useEffect(() => {
    setNudgeEditPrompt((prev) => {
      if (!prev) return null
      const next = nudges.find((x) => x.id === prev.id)
      return next ?? null
    })
  }, [nudges])

  const applyPoisBatch = useCallback((all: MapPoi[]) => {
    poisRef.current = all
    setPois(all)
    setPoiFetchActive(false)
  }, [])

  const onPoiProgress = useCallback((info: PoiFetchProgressInfo) => {
    const total = Math.max(1, info.totalSteps)
    const next = info.completedSteps / total
    if (!info.isRunning) {
      setPoiFetchActive(false)
      setPoiProgress(info.completedSteps >= total ? 1 : 0)
      return
    }
    const now = Date.now()
    const throttleMs = 350
    const step = info.completedSteps
    if (step === 0 || step === 1 || now - poiProgressEmitRef.current.lastTs >= throttleMs) {
      poiProgressEmitRef.current.lastTs = now
      setPoiProgress(Math.max(0.06, Math.min(0.99, Math.max(next, 0.06))))
    }
  }, [])

  const refreshAll = useCallback(async () => {
    const uid = effectiveUserId(user?.id)
    const [nRes, hRes, defaultRadius] = await Promise.all([
      fetchUserNudges(uid),
      fetchUserHome(uid),
      loadDefaultRadiusMeters(),
    ])
    if (!nRes.error) {
      setNudges(nRes.data)
      hasLoadedInitialNudgesRef.current = true
    }
    if (!hRes.error) setHomeRow(hRes.data)
    if (!hRes.error && hRes.data?.id) {
      const leaveExists = await hasLeavingHomeNudge(uid, hRes.data.id)
      setHasHomeLeaveNudge(leaveExists)
    } else {
      setHasHomeLeaveNudge(false)
    }
    setRadiusMeters(defaultRadius)
    setHomeGateChecked(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveUserId(user?.id) read fresh each call
  }, [])

  useEffect(() => {
    if (!isFocused) return
    void onRefocusRequestLocation()
    void refreshAll()
  }, [isFocused, onRefocusRequestLocation, refreshAll])

  useEffect(() => {
    if (!homeGateChecked) return
    if (homeGateDismissedRef.current) return
    setHomeGateOpen(!homeRow)
  }, [homeRow, homeGateChecked])

  useEffect(() => {
    registerLeavingHomeComposeHandler((home) => {
      setPendingCreate({
        lat: home.lat,
        lng: home.lng,
        title: 'Leaving home',
        category: '⭐',
      })
      setRadiusMeters(home.radius_meters)
      setEditNudge(null)
      setNudgeModalOpen(true)
    })
    return () => registerLeavingHomeComposeHandler(null)
  }, [registerLeavingHomeComposeHandler])

  useEffect(() => () => poiAbortRef.current?.abort(), [])

  useEffect(() => {
    if (region && !regionPublishedRef.current) {
      regionPublishedRef.current = region
    }
  }, [region])

  const shouldPublishRegionToState = useCallback((r: Region, lastPublished: Region | null) => {
    if (!lastPublished) return true
    const moved = distanceMetres(
      { lat: lastPublished.latitude, lng: lastPublished.longitude },
      { lat: r.latitude, lng: r.longitude },
    )
    if (moved >= MIN_REGION_PUBLISH_MOVE_M) return true
    const zoomChanged =
      Math.abs(lastPublished.latitudeDelta - r.latitudeDelta) > lastPublished.latitudeDelta * 0.12 ||
      Math.abs(lastPublished.longitudeDelta - r.longitudeDelta) > lastPublished.longitudeDelta * 0.12
    return zoomChanged
  }, [])

  const maybeFetchPoisForRegion = useCallback(
    (r: Region, opts?: { force?: boolean }) => {
      void (async () => {
        if (Math.max(r.latitudeDelta, r.longitudeDelta) < 0.001) return
        if (!isValidMapRegionForFetch(r)) return

        /* Always fetch when the region is valid — zoom-based gating left too many views with zero POIs (Nominatim viewbox is fixed-size anyway). */
        const center = { lat: r.latitude, lng: r.longitude }
        const areaKey = poiAreaCacheKey(center.lat, center.lng)
        const prevCenter = lastPoiFetchCenterRef.current
        const movedM = prevCenter == null ? null : distanceMetres(center, prevCenter)
        const sameAreaBucket =
          lastPoiFetchAreaKeyRef.current != null && lastPoiFetchAreaKeyRef.current === areaKey

        const isNeighbourOfLastArea = (() => {
          const lastKey = lastPoiFetchAreaKeyRef.current
          if (!lastKey) return false
          for (const dLat of [-0.01, 0, 0.01]) {
            for (const dLng of [-0.01, 0, 0.01]) {
              if (dLat === 0 && dLng === 0) continue
              if (poiAreaCacheKey(center.lat + dLat, center.lng + dLng) === lastKey) return true
            }
          }
          return false
        })()

        /* Only skip when still in same or adjacent 2dp tile *and* centre barely moved. */
        if (!opts?.force && prevCenter != null && movedM != null && movedM < POI_FETCH_MIN_MOVE_M && (sameAreaBucket || isNeighbourOfLastArea)) {
          console.log('[POI] skip (same cache bucket, moved < 500m)', {
            areaKey,
            movedM: Math.round(movedM),
          })
          /* No in-flight request: clear any stale loading UI (e.g. interrupted run). */
          if (poiAbortRef.current == null) {
            setPoiFetchActive(false)
            setPoiProgress(0)
          }
          return
        }

        lastPoiFetchCenterRef.current = center

        poiAbortRef.current?.abort()
        poiAbortRef.current = null

        const perQueryLimit = 50
        const span = Math.max(r.latitudeDelta, r.longitudeDelta)
        const nudgeCoords = nudgeCoordsRef.current

        const runNetworkFetch = (silent: boolean) => {
          const ac = new AbortController()
          poiAbortRef.current = ac
          if (!silent) {
            poiFetchCountRef.current += 1
            console.log('[POI fetch] NETWORK foreground', {
              run: poiFetchCountRef.current,
              areaKey,
              span: span.toFixed(4),
              movedM: movedM == null ? null : Math.round(movedM),
              force: Boolean(opts?.force),
            })
            setPoiFetchActive(true)
            setPoiProgress(0.08)
          } else {
            console.log('[POI fetch] NETWORK silent refresh', { areaKey })
          }

          const finalize = (_la: number, _ln: number, accumulated: MapPoi[]) => {
            const filtered = filterPoisAwayFromNudges(accumulated, nudgeCoords)
            if (!silent) {
              setPoiProgress(1)
              /* Empty finalize must not wipe markers (timeouts / partial batches). */
              if (filtered.length > 0) {
                applyPoisBatch(filtered)
                lastPoiFetchAreaKeyRef.current = areaKey
                void putPoiAreaCache(areaKey, filtered)
              } else {
                setPoiFetchActive(false)
              }
            } else if (filtered.length > 0) {
              /* Silent refresh: never clear POIs with [] — only update when we got hits. */
              poisRef.current = filtered
              setPois(filtered)
              lastPoiFetchAreaKeyRef.current = areaKey
              void putPoiAreaCache(areaKey, filtered)
            }
          }

          return fetchNearbyPoisSequential(
            center.lat,
            center.lng,
            nudgeCoords,
            ac.signal,
            silent ? undefined : onPoiProgress,
            (batch) => {
              const filtered = filterPoisAwayFromNudges(batch, nudgeCoords)
              if (filtered.length > 0) {
                if (silent) {
                  poisRef.current = filtered
                  setPois(filtered)
                } else {
                  applyPoisBatch(filtered)
                }
                lastPoiFetchAreaKeyRef.current = areaKey
                void putPoiAreaCache(areaKey, filtered)
              }
            },
            finalize,
            perQueryLimit,
          )
        }

        if (!opts?.force) {
          try {
            const cachedRow = await touchAndReadPoiAreaCache(areaKey)
            if (cachedRow) {
              const filtered = filterPoisAwayFromNudges(cachedRow.pois, nudgeCoords)
              if (filtered.length === 0) {
                // Cache hit but all POIs filtered out — still a hit, skip network fetch
                lastPoiFetchAreaKeyRef.current = areaKey
                return
              } else {
                console.log('[POI cache] HIT', { areaKey, poiCount: filtered.length })
                poisRef.current = filtered
                setPois(filtered)
                setPoiFetchActive(false)
                setPoiProgress(1)
                lastPoiFetchAreaKeyRef.current = areaKey
                const vc = cachedRow.visitCount
                if (vc % 10 !== 0) return
                await runNetworkFetch(true)
                setPoiProgress(1)
                return
              }
            }
            console.log('[POI cache] MISS → network', { areaKey })
          } catch (e) {
            console.warn('[POI cache] read error → network', e)
          }
        } else {
          console.log('[POI fetch] force network (nudges changed etc.)', { areaKey })
        }

        await runNetworkFetch(false)
      })()
    },
    [onPoiProgress, applyPoisBatch],
  )

  /** Refetch POIs when nudges change (near-nudge filtering). Skipped when zoomed out. */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasLoadedInitialNudgesRef.current) return
      const r = stableMapRegionRef.current
      if (!r || !isValidMapRegionForFetch(r)) return
      lastPoiFetchCenterRef.current = null
      lastPoiFetchAreaKeyRef.current = null
      maybeFetchPoisForRegion(r, { force: true })
    }, 800)
    return () => clearTimeout(timer)
  // maybeFetchPoisForRegion is stable (no nudges in deps); only re-run when nudges change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudges])

  /** Refetch POIs when map style changes (dark/light mode toggle). */
  useEffect(() => {
    const r = stableMapRegionRef.current
    if (!r || !isValidMapRegionForFetch(r)) return
    lastPoiFetchCenterRef.current = null
    lastPoiFetchAreaKeyRef.current = null
    maybeFetchPoisForRegion(r, { force: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkMode])

  useEffect(() => {
    if (!isFocused) return
    if (hasDoneInitialPoiFetchRef.current) return
    const r = stableMapRegionRef.current ?? initialRegion
    if (!isValidMapRegionForFetch(r)) return
    hasDoneInitialPoiFetchRef.current = true
    maybeFetchPoisForRegion(r)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial POI once per focus; stable maybeFetchPoisForRegion
  }, [isFocused, maybeFetchPoisForRegion])

  /**
   * Pre-fetch POIs for the home location tile (`lib/poi-fetch`, OSM/Nominatim for POI pins only).
   * Address search uses Google Places only.
   */
  useEffect(() => {
    if (!homeRow) return

    const areaKey = poiAreaCacheKey(homeRow.lat, homeRow.lng)
    const nudgeCoords = nudgeCoordsRef.current

    let cancelled = false
    void (async () => {
      try {
        const cached = await peekPoiAreaCache(areaKey)
        if (cancelled) return
        if (cached !== null && cached.length > 0) {
          console.log('[POI prefetch home] skip (cached)', { areaKey, count: cached.length })
          return
        }
        console.log('[POI prefetch home] fetching', { areaKey, lat: homeRow.lat, lng: homeRow.lng })
        homePoiPrefetchAbortRef.current?.abort()
        const ac = new AbortController()
        homePoiPrefetchAbortRef.current = ac
        await fetchNearbyPoisSequential(
          homeRow.lat,
          homeRow.lng,
          nudgeCoords,
          ac.signal,
          undefined,
          (batch) => {
            const filtered = filterPoisAwayFromNudges(batch, nudgeCoords)
            if (filtered.length > 0) {
              void putPoiAreaCache(areaKey, filtered)
            }
          },
          (_la, _ln, accumulated) => {
            const filtered = filterPoisAwayFromNudges(accumulated, nudgeCoords)
            if (filtered.length > 0) void putPoiAreaCache(areaKey, filtered)
          },
          50,
        )
        if (!cancelled) console.log('[POI prefetch home] done', { areaKey })
      } catch (e) {
        if (!cancelled) console.warn('[POI prefetch home] failed', e)
      }
    })()

    return () => {
      cancelled = true
      homePoiPrefetchAbortRef.current?.abort()
      homePoiPrefetchAbortRef.current = null
    }
  }, [homeRow?.id, homeRow?.lat, homeRow?.lng])

  const nudgesOnMap = useMemo(
    () =>
      nudges.filter(
        (n) =>
          Number.isFinite(n.lat) &&
          Number.isFinite(n.lng) &&
          activeCategories.has(n.category ?? '⭐'),
      ),
    [nudges, activeCategories],
  )

  const spanSafeForClustering = useMemo(() => {
    const s = mapSpanForClustering
    if (!Number.isFinite(s) || s <= 0) {
      return Math.max(initialRegion.latitudeDelta, initialRegion.longitudeDelta)
    }
    return s
  }, [mapSpanForClustering, initialRegion.latitudeDelta, initialRegion.longitudeDelta])

  const clusteredNudges = useMemo(
    () => clusterMapNudges(nudgesOnMap, spanSafeForClustering),
    [nudgesOnMap, spanSafeForClustering],
  )

  const filteredPois = useMemo(() => {
    let list = pois.filter((p) => activeCategories.has(p.category))
    if (nudgesOnMap.length === 0) return list
    list = list.filter(
      (p) =>
        !nudgesOnMap.some((n) => {
          const rM = Math.max(1, Number(n.radius_meters) || 25)
          return (
            distanceMetres({ lat: p.lat, lng: p.lng }, { lat: n.lat, lng: n.lng }) <=
            rM + POI_HIDE_INSIDE_NUDGE_RADIUS_MARGIN_M
          )
        }),
    )
    return list
  }, [pois, activeCategories, nudgesOnMap])

  const clusteredPois = useMemo(
    () => clusterMapPois(filteredPois, spanSafeForClustering),
    [filteredPois, spanSafeForClustering],
  )

  const allFiltersActive = useMemo(() => CATEGORIES.every((c) => activeCategories.has(c)), [activeCategories])

  const toggleAllCategoryFilters = useCallback(() => {
    setActiveCategories((prev) => {
      const everyOn = CATEGORIES.every((c) => prev.has(c))
      if (everyOn) return new Set()
      return new Set(CATEGORIES)
    })
  }, [])

  const locateUser = async () => {
    let { status } = await Location.getForegroundPermissionsAsync().catch(() => ({ status: 'denied' as const }))
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync().catch(() => ({ status: 'denied' as const }))
      status = req.status
    }
    if (status !== 'granted') {
      Alert.alert('Location unavailable', 'Please grant location access in Settings.')
      return
    }
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]).catch(() => null)
    if (pos && pos.coords && Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude)) {
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      void cameraRef.current?.flyTo([coords.lng, coords.lat], 300)
      setIsMapCenteredOnUser(true)
    } else {
      Alert.alert('Location unavailable', 'Couldn\'t get your current location.')
    }
  }

  const handleMapPress = useCallback(
    async (e: any) => {
      const lngLat = e?.nativeEvent?.lngLat as [number, number] | undefined
      if (!lngLat || !Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) return
      const longitude = lngLat[0]
      const latitude = lngLat[1]
      Keyboard.dismiss()
      if (mapRef.current) {
        try {
          const tapPt = await mapRef.current.project([longitude, latitude])
          if (tapPt) {
            const clusters = ([...clusteredPois, ...clusteredNudges] as Array<{ kind: string; centerLng: number; centerLat: number }>)
              .filter(i => i.kind === 'cluster')
            for (const cluster of clusters) {
              const pt = await mapRef.current?.project([cluster.centerLng, cluster.centerLat])
              if (pt) {
                const dx = pt[0] - tapPt[0]
                const dy = pt[1] - tapPt[1]
                if (Math.sqrt(dx * dx + dy * dy) < 40) return
              }
            }
          }
        } catch { /* skip guard on error */ }
      }
      if (homeMapPickActive) {
        setHomeDraft((prev) => ({
          lat: latitude,
          lng: longitude,
          name: prev?.name?.trim() || 'Home',
        }))
        setHomeMapPickActive(false)
        return
      }
      const nearbyNudge = nudgesOnMap.find(
        (n) => distanceMetres({ lat: latitude, lng: longitude }, { lat: n.lat, lng: n.lng }) <= 30,
      )
      if (nearbyNudge) {
        setNudgeEditPrompt(nearbyNudge)
        return
      }
      const nearCluster = ([...clusteredPois, ...clusteredNudges] as Array<{ kind: string; centerLat: number; centerLng: number }>)
        .filter(i => i.kind === 'cluster')
        .some(i => distanceMetres({ lat: latitude, lng: longitude }, { lat: i.centerLat, lng: i.centerLng }) <= 200)
      if (nearCluster) return
      setNudgeEditPrompt(null)
      setSearchAnchor(null)
      setTapDraft({ lat: latitude, lng: longitude, category: '⭐' })
      void cameraRef.current?.flyTo([longitude, latitude], 280)
    },
    [homeMapPickActive, clusteredPois, clusteredNudges, nudgesOnMap],
  )

  const handleRegionDidChange = useCallback(
    (event: any) => {
      const center = event?.nativeEvent?.center as [number, number] | undefined
      const bounds = event?.nativeEvent?.bounds as [number, number, number, number] | undefined
      if (!center || !bounds) return
      const [west, south, east, north] = bounds
      const r: Region = {
        latitude: center[1],
        longitude: center[0],
        latitudeDelta: north - south,
        longitudeDelta: east - west,
      }
      stableMapRegionRef.current = r
      setMapSpanForClustering(Math.max(r.latitudeDelta, r.longitudeDelta))
      maybeFetchPoisForRegion(r)
      if (shouldPublishRegionToState(r, regionPublishedRef.current)) {
        regionPublishedRef.current = r
        setRegion(r)
      }
      if (!userCoords) return
      const centerDistanceM = distanceMetres(
        { lat: r.latitude, lng: r.longitude },
        { lat: userCoords.lat, lng: userCoords.lng },
      )
      setIsMapCenteredOnUser(centerDistanceM <= 60 && r.latitudeDelta <= 0.03)
    },
    [userCoords, maybeFetchPoisForRegion, shouldPublishRegionToState],
  )

  const saveNudge = useCallback(
    async (payload: NudgeSavePayload) => {
      console.log('[saveNudge] start', {
        hasSessionUser: Boolean(user?.id),
        nudgeId: payload.nudgeId,
        locationId: payload.locationId,
        titleLen: (payload.title ?? '').trim().length,
      })
      const uid = effectiveUserId(user?.id)
      if (payload.nudgeId && payload.locationId) {
        const up = await updateNudgeForUser(uid, payload.nudgeId, payload.locationId, payload)
        if (up.error) {
          console.warn('[saveNudge] update failed', up.error)
        } else {
          setNudgeModalOpen(false)
          setEditNudge(null)
          setPendingCreate(null)
          setTapDraft(null)
          setNudgeEditPrompt(null)
          showToast('Nudge saved!')
          void refreshAll()
        }
        return
      }
      let locationId = payload.reuseLocationId
      if (!locationId) {
        const loc = await supabase
          .from('locations')
          .insert({
            user_id: uid,
            name: payload.location.trim() || payload.title.trim(),
            lat: payload.coordinates.lat,
            lng: payload.coordinates.lng,
            radius_meters: payload.radius_meters,
            is_home: false,
          })
          .select('id')
          .single()
        if (loc.error || !loc.data?.id) {
          console.warn('[saveNudge] locations insert failed', loc.error)
          Alert.alert('Save failed', loc.error?.message ?? 'Location insert returned no data')
          return
        }
        locationId = loc.data.id
      }
      const ins = await supabase.from('nudges').insert({
        user_id: uid,
        location_id: locationId,
        title: payload.title.trim(),
        notes: payload.notes.trim() || null,
        trigger_type: payload.trigger,
        radius_meters: payload.radius_meters,
        category: payload.category,
        is_active: true,
      })
      if (ins.error) {
        console.warn('[saveNudge] nudges insert failed', ins.error)
        Alert.alert('Save failed', ins.error?.message ?? 'Nudge insert failed')
      } else {
        setNudgeModalOpen(false)
        setPendingCreate(null)
        setEditNudge(null)
        setTapDraft(null)
        setNudgeEditPrompt(null)
        showToast('Nudge saved!')
        void refreshAll()
      }
    },
    [refreshAll, showToast],
  )

  const deleteNudge = useCallback(
    (id: string) => {
      const uid = effectiveUserId(user?.id)
      Alert.alert('Delete nudge?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteNudgeForUser(uid, id)
            if (!res.error) {
              await refreshAll()
              setNudgeModalOpen(false)
              setEditNudge(null)
              setNudgeEditPrompt(null)
              setTapDraft(null)
              setPendingCreate(null)
              showToast('Nudge deleted')
            }
          },
        },
      ])
    },
    [refreshAll, showToast, user?.id],
  )

  if (!mapInitialRegionRef.current) {
    mapInitialRegionRef.current = region
    initialCameraSettingsRef.current = {
      center: [region.longitude, region.latitude],
      zoom: latDeltaToZoom(region.latitudeDelta),
    }
  }

  const mapSearchLat = stableMapRegionRef.current?.latitude ?? region.latitude
  const mapSearchLng = stableMapRegionRef.current?.longitude ?? region.longitude
  const mapSpanLatDelta = stableMapRegionRef.current?.latitudeDelta ?? region.latitudeDelta
  const mapSpanLngDelta = stableMapRegionRef.current?.longitudeDelta ?? region.longitudeDelta

  const showPoiLoadingStrip = poiFetchActive || (poiProgress > 0 && poiProgress < 1)
  const poiLoadingBarPct = Math.max(10, Math.round(poiProgress * 100))

  const editPromptOpen = Boolean(nudgeEditPrompt && !nudgeModalOpen)
  const addPromptOpen = Boolean(tapDraft && !nudgeModalOpen && !nudgeEditPrompt)

  const bottomPromptCard = editPromptOpen ? (
    <View style={styles.tapPrompt}>
      <View style={styles.tapPromptTitleRow}>
        <Text style={[styles.tapPromptTitle, styles.tapPromptTitleInEditRow]} numberOfLines={2}>
          {nudgeEditPrompt?.title ?? 'Edit this nudge?'}
        </Text>
        <Pressable
          onPress={() => {
            const n = nudgeEditPrompt
            if (!n) return
            setNudgeEditPrompt(null)
            deleteNudge(n.id)
          }}
          hitSlop={8}
          accessibilityLabel="Delete nudge"
          style={styles.tapPromptDeleteIcon}
        >
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
        </Pressable>
      </View>
      <View style={styles.tapPromptActions}>
        <Pressable style={styles.tapPromptCancel} onPress={() => setNudgeEditPrompt(null)}>
          <Text style={styles.tapPromptCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.tapPromptAdd}
          onPress={() => {
            const id = nudgeEditPrompt?.id
            if (!id) return
            const fresh = nudges.find((x) => x.id === id) ?? nudgeEditPrompt
            if (!fresh) return
            setEditNudge(fresh)
            setRadiusMeters(fresh.radius_meters)
            setNudgeEditPrompt(null)
            setTapDraft(null)
            setPendingCreate(null)
            setNudgeModalOpen(true)
          }}
        >
          <Text style={styles.tapPromptAddText}>Edit</Text>
        </Pressable>
      </View>
    </View>
  ) : addPromptOpen ? (
    <View style={styles.tapPrompt}>
      <Text style={styles.tapPromptTitle}>Add Nudge here?</Text>
      <View style={styles.tapPromptSliderRow}>
        <Text style={styles.tapPromptLabel}>Radius</Text>
        <Slider
          style={{ flex: 1, height: 32 }}
          minimumValue={10}
          maximumValue={100}
          step={5}
          value={radiusMeters}
          minimumTrackTintColor={ACCENT}
          maximumTrackTintColor="rgba(255,255,255,0.28)"
          thumbTintColor={ACCENT}
          onValueChange={(v) => setRadiusMeters(Math.round(v))}
        />
        <Text style={styles.tapPromptValue}>{radiusMeters}m</Text>
      </View>
      <View style={styles.tapPromptActions}>
        <Pressable style={styles.tapPromptCancel} onPress={() => setTapDraft(null)}>
          <Text style={styles.tapPromptCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.tapPromptAdd}
          onPress={() => {
            if (!tapDraft) return
            setPendingCreate({
              lat: tapDraft.lat,
              lng: tapDraft.lng,
              title: tapDraft.title,
              category: tapDraft.category ?? '⭐',
            })
            setNudgeModalOpen(true)
          }}
        >
          <Text style={styles.tapPromptAddText}>Add</Text>
        </Pressable>
      </View>
    </View>
  ) : null

  return (
    <View style={styles.root}>
      <View style={styles.mapShell}>
        <MapLibreMap
          ref={mapRef}
          style={styles.map}
          mapStyle={isDarkMode ? STYLE_DARK : STYLE_LIGHT}
          onPress={handleMapPress}
          onRegionDidChange={handleRegionDidChange}
          onDidFailLoadingMap={(error) => console.error('Map failed to load:', error)}
          onDidFinishLoadingMap={() => console.log('Map loaded successfully')}
          onDidFinishLoadingStyle={() => {
            console.log('Map style loaded successfully')
            if (poisRef.current.length > 0) {
              setPois([...poisRef.current])
            }
          }}
        >
          <Camera
            ref={cameraRef}
            initialViewState={initialCameraSettingsRef.current ?? undefined}
          />
          {nudgesOnMap.map((n) => (
            <GeoJSONSource
              key={`nudge-zone-${n.id}`}
              id={`nudge-zone-${n.id}`}
              data={geoCircleFeature(n.lat, n.lng, Math.max(1, Number(n.radius_meters) || 25))}
            >
              <Layer type="fill"
                id={`nudge-fill-${n.id}`}
                paint={{ 'fill-color': 'rgba(0,191,165,0.15)' }}
              />
              <Layer type="line"
                id={`nudge-line-${n.id}`}
                paint={{ 'line-color': POI_MAP_BLUE, 'line-width': 2 }}
              />
            </GeoJSONSource>
          ))}
          {homeRow ? (
            <>
              <GeoJSONSource
                id="home-zone"
                data={geoCircleFeature(homeRow.lat, homeRow.lng, homeRow.radius_meters)}
              >
                <Layer type="fill"
                  id="home-fill"
                  paint={{ 'fill-color': 'rgba(0,191,165,0.10)' }}
                />
                <Layer type="line"
                  id="home-line"
                  paint={{ 'line-color': 'rgba(0,191,165,0.8)', 'line-width': 1 }}
                />
              </GeoJSONSource>
            </>
          ) : null}
          {tapDraft ? (
            <>
              <GeoJSONSource
                id="tap-draft-zone"
                data={geoCircleFeature(tapDraft.lat, tapDraft.lng, radiusMeters)}
              >
                <Layer type="fill"
                  id="tap-draft-fill"
                  paint={{ 'fill-color': 'rgba(0,191,165,0.18)' }}
                />
                <Layer type="line"
                  id="tap-draft-line"
                  paint={{ 'line-color': 'rgba(0,191,165,0.95)', 'line-width': 2 }}
                />
              </GeoJSONSource>
            </>
          ) : null}
          {clusteredNudges.map((item) =>
            item.kind === 'cluster' ? (
              <MapNudgeClusterMarker
                key={item.key}
                item={item}
                onPress={() => {
                  void cameraRef.current?.flyTo([item.centerLng, item.centerLat], 400)
                }}
              />
            ) : (
              <MapNudgeMarker
                key={item.nudge.id}
                nudge={item.nudge}
                onPress={() => setNudgeEditPrompt(item.nudge)}
              />
            )
          )}
          {clusteredPois.map((item) =>
            item.kind === 'cluster' ? (
              <MapClusterMarker
                key={item.key}
                item={item}
                onPress={() => {
                  console.log('[Cluster tap] members:', item.members.length)
                  console.log('[Cluster tap] cameraRef:', !!cameraRef.current, typeof cameraRef.current?.flyTo)
                  setNudgeEditPrompt(null)
                  if (item.members.length <= 3) {
                    setTapDraft({
                      lat: item.centerLat,
                      lng: item.centerLng,
                      title: (() => {
                        const named = item.members
                          .map(m => m.label.split(',')[0].trim())
                          .filter((name, i) => name !== item.members[i].category && name !== item.members[i].displayKey)
                        return named.length > 0 ? named.join(' / ') : (item.members[0]?.category ?? '⭐')
                      })(),
                      category: item.members[0]?.category ?? '⭐',
                    })
                  } else {
                    void cameraRef.current?.flyTo([item.centerLng, item.centerLat], 400)
                  }
                }}
              />
            ) : (
              <MapPoiMarker
                key={item.poi.key}
                poi={item.poi}
                onPress={() => {
                  setNudgeEditPrompt(null)
                  setTapDraft({
                    lat: item.poi.lat,
                    lng: item.poi.lng,
                    title: `${item.poi.label.split(',')[0].trim()} ${item.poi.displayKey}`,
                    category: item.poi.category,
                  })
                  void cameraRef.current?.flyTo([item.poi.lng, item.poi.lat], 400)
                }}
              />
            )
          )}
        </MapLibreMap>
      </View>
      <View style={[styles.searchWrap, { top: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.searchCard} pointerEvents="auto">
          <GooglePlacesAddressSearchField
            variant="mapBar"
            onSearchTextChange={(t) => {
              if (!t.trim()) setSearchAnchor(null)
            }}
            enabled
            placeholder="Search places"
            accentColor={ACCENT}
            surfaceColor={SURFACE}
            mapBarStyle={styles.searchInputWrap}
            mapLat={mapSearchLat}
            mapLng={mapSearchLng}
            onSelect={(r) => {
              setSearchAnchor({ lat: r.lat, lng: r.lng })
              setPendingCreate({
                lat: r.lat,
                lng: r.lng,
                title: (r.display_name || r.name).trim().split(',')[0].trim(),
                category: '⭐',
              })
              void cameraRef.current?.flyTo([r.lng, r.lat], 400)
              setTimeout(() => cameraRef.current?.zoomTo(14, 400), 100)
            }}
          />
        </View>
      </View>

      <View style={styles.bottomFilterSafeArea} pointerEvents="box-none">
        <View style={styles.bottomFloatingColumn} pointerEvents="box-none">
          {showPoiLoadingStrip ? (
            <View style={styles.poiLoadingStackBlock} pointerEvents="none">
              <Text
                style={styles.poiLoadingTitle}
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              >
                Loading nearby places...
              </Text>
              <View style={styles.poiLoadingCard}>
                <ActivityIndicator color={ACCENT} size="small" />
                <View style={styles.poiLoadingTrack}>
                  <View style={[styles.poiLoadingFill, { width: `${poiLoadingBarPct}%` }]} />
                </View>
              </View>
            </View>
          ) : null}
          {bottomPromptCard ? (
            <View style={styles.bottomPromptSlot} pointerEvents="auto">
              {bottomPromptCard}
            </View>
          ) : null}
          {!homeRow && homeGateChecked ? (
            <Pressable
              pointerEvents="auto"
              style={styles.addHomeBtn}
              onPress={() => setHomeGateOpen(true)}
            >
              <Ionicons name="home-outline" size={15} color="#0a0a0a" />
              <Text style={styles.addHomeBtnText}>Add home location</Text>
            </Pressable>
          ) : null}
          <LinearGradient
            colors={['transparent', 'rgba(10,10,10,0.88)']}
            locations={[0, 1]}
            style={styles.filterGradient}
          >
            <View style={styles.filterRowCombined} pointerEvents="box-none">
              <View style={styles.filterLabelRow} pointerEvents="none">
                <Ionicons name="options-outline" size={17} color="#fff" style={styles.filterOptionsIcon} />
                <Text style={styles.filterLabelText}>Filter</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsScroll}
                contentContainerStyle={styles.chips}
                keyboardShouldPersistTaps="handled"
              >
                {CATEGORIES.map((cat) => {
                  const on = activeCategories.has(cat)
                  return (
                    <Pressable
                      key={cat}
                      onPress={() =>
                        setActiveCategories((prev) => {
                          const next = new Set(prev)
                          if (next.has(cat)) next.delete(cat)
                          else next.add(cat)
                          return next
                        })
                      }
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <CategoryIcon category={cat} size={18} color={on ? '#0a0a0a' : ACCENT} />
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{CATEGORY_LABELS[cat]}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              <Pressable onPress={toggleAllCategoryFilters} style={styles.filterAllNoneBtn} hitSlop={6}>
                <Text style={styles.filterAllNoneBtnText}>{allFiltersActive ? 'None' : 'All'}</Text>
              </Pressable>
            </View>
          </LinearGradient>
        </View>
      </View>
      <Pressable
        style={[
          styles.locateBtn,
          isMapCenteredOnUser ? styles.locateBtnOn : styles.locateBtnOff,
          { top: insets.top + 104 },
        ]}
        onPress={() => void locateUser()}
      >
        <Ionicons name="locate" size={16} color={isMapCenteredOnUser ? '#0a0a0a' : '#fff'} />
      </Pressable>
      <Pressable
        style={[styles.mapTypeBtn, { top: insets.top + 56 }]}
        onPress={() => setIsDarkMode((prev) => !prev)}
      >
        <Ionicons name={isDarkMode ? 'sunny' : 'moon'} size={17} color="#fff" />
      </Pressable>

      <NudgeModal
        isOpen={nudgeModalOpen}
        onClose={() => {
          setNudgeModalOpen(false)
          setEditNudge(null)
          setPendingCreate(null)
          setTapDraft(null)
          setNudgeEditPrompt(null)
        }}
        onSave={saveNudge}
        onDelete={deleteNudge}
        editNudge={editNudge}
        initialCoordinates={pendingCreate ? { lat: pendingCreate.lat, lng: pendingCreate.lng } : null}
        initialTitle={pendingCreate?.title}
        initialCategory={pendingCreate?.category}
        radiusMeters={radiusMeters}
        onRadiusMetersChange={setRadiusMeters}
        visualPreset="mapGeofencePreview"
      />

      <HomeLocationGateModal
        visible={homeGateOpen}
        mapLat={mapSearchLat}
        mapLng={mapSearchLng}
        mapPickActive={homeMapPickActive}
        draft={homeDraft}
        onDraftNameChange={(name) => setHomeDraft((d) => (d ? { ...d, name } : d))}
        onDismissSecondary={() => {
          setHomeGateOpen(false)
          /* Always remember dismiss — without this, no-home + "Not now" re-opens on every refresh. */
          homeGateDismissedRef.current = true
        }}
        onStartMapPick={() => {
          setHomeMapPickActive(true)
          setHomeGateOpen(false)
        }}
        onSave={async () => {
          if (!homeDraft) return
          const uid = effectiveUserId(user?.id)
          setHomeSaving(true)
          const res = await upsertUserHome(uid, {
            name: homeDraft.name,
            lat: homeDraft.lat,
            lng: homeDraft.lng,
            radiusMeters: 75,
          })
          setHomeSaving(false)
          if (!res.error && res.data) {
            setHomeRow(res.data)
            setHomeGateOpen(false)
            homeGateDismissedRef.current = true
            setHomeDraft(null)
            invalidateLeavingHomePromptCheck()
          }
        }}
        saving={homeSaving}
        onSelectSearchResult={(r) => {
          const raw = (r.display_name || r.name).trim()
          setHomeDraft({
            lat: r.lat,
            lng: r.lng,
            name: raw.split(',')[0].trim() || raw || 'Home',
          })
          setHomeGateOpen(true)
        }}
      />
      {homeMapPickActive ? (
        <View style={[styles.mapPickBanner, { top: insets.top + 56 }]}>
          <Text style={styles.mapPickText}>Tap map to place home pin</Text>
          <Pressable
            onPress={() => {
              setHomeMapPickActive(false)
              setHomeGateOpen(true)
            }}
          >
            <Text style={styles.mapPickCancel}>Back</Text>
          </Pressable>
        </View>
      ) : null}
      {homeRow && !hasHomeLeaveNudge ? (
        <Pressable
          style={[styles.leaveHomeQuick, { bottom: (insets.bottom > 0 ? insets.bottom : 8) + 142 }]}
          onPress={async () => {
            const uid = effectiveUserId(user?.id)
            const r = await createLeavingHomeNudgeIfAbsent(uid, homeRow.id, homeRow.radius_meters)
            if (!r.error) await refreshAll()
          }}
        >
          <Ionicons name="log-out-outline" size={16} color="#0a0a0a" />
          <Text style={styles.leaveHomeQuickText}>Add leaving-home nudge</Text>
        </Pressable>
      ) : null}
      {toastVisible ? (
        <View pointerEvents="box-none" style={styles.toastHost}>
          <NudgeToast
            visible={toastVisible}
            message={toastMessage}
            onHide={() => setToastVisible(false)}
          />
        </View>
      ) : null}
    </View>
  )
}

/** Shell: fixed hook count per render; early returns only after the last hook (`useEffect`). */
export default function MapScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const isFocused = useIsFocused()
  const [locationBooting, setLocationBooting] = useState(true)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [region, setRegion] = useState<Region | null>(null)
  const [locationFallbackModalVisible, setLocationFallbackModalVisible] = useState(false)
  const [openHomeGateOnLoad, setOpenHomeGateOnLoad] = useState(false)
  const hasDoneInitialLocationBootRef = useRef(false)
  const hasShownLocationFallbackModalRef = useRef(false)

  const requestLocation = useCallback(async (opts?: { showSplash?: boolean }) => {
    if (opts?.showSplash) setLocationBooting(true)

    let resolvedCoords: { lat: number; lng: number } | null = null

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, LOCATION_TIMEOUT_MS)

      void (async () => {
        try {
          const existingPerm = await Location.getForegroundPermissionsAsync().catch(() => null)
          let status = existingPerm?.status ?? 'undetermined'
          if (status !== 'granted') {
            const requested = await Location.requestForegroundPermissionsAsync().catch(() => null)
            status = requested?.status ?? status
          }

          if (status === 'granted') {
            const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true)
            if (servicesEnabled) {
              const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
              if (pos?.coords && Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude)) {
                resolvedCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
              }
            }
          }
        } catch {
          // fall through; resolvedCoords stays null
        } finally {
          if (resolvedCoords !== null) {
            // Real GPS obtained — dismiss splash early and cancel the timer
            clearTimeout(timer)
            resolve()
          }
          // No real GPS — let the timer fire naturally after LOCATION_TIMEOUT_MS
        }
      })()
    })

    if (resolvedCoords !== null) {
      setUserCoords(resolvedCoords)
      setRegion((prev) => prev ?? toRegionFromCoords(resolvedCoords!))
      setLocationBooting(false)
      setLocationFallbackModalVisible(false)
    } else {
      // GPS timed out — check if home row is available to use silently
      const uid = effectiveUserId(null)
      const hRes = await fetchUserHome(uid).catch(() => ({ data: null, error: true }))
      if (!hRes.error && hRes.data) {
        const homeCoords = { lat: hRes.data.lat, lng: hRes.data.lng }
        setUserCoords(homeCoords)
        setRegion((prev) => prev ?? toRegionFromCoords(homeCoords))
        setLocationBooting(false)
      } else {
        // No home row — show modal for user to choose (only once)
        if (hasShownLocationFallbackModalRef.current) return
        hasShownLocationFallbackModalRef.current = true
        setLocationFallbackModalVisible(true)
      }
    }
  }, [])

  useEffect(() => {
    if (!isFocused) return
    if (!hasDoneInitialLocationBootRef.current) {
      hasDoneInitialLocationBootRef.current = true
      void requestLocation({ showSplash: true })
    }
  }, [isFocused, requestLocation])

  // TODO: Re-enable auth before launch.
  // if (!user) return <AppStartupSplash message="Loading your account…" />

  return (
    <>
      {locationBooting || !userCoords || !region ? (
        <AppStartupSplash message="Getting your location…" />
      ) : (
        <MapScreenBody
          user={user}
          insets={insets}
          initialRegion={region}
          initialUserCoords={userCoords}
          openHomeGateOnLoad={openHomeGateOnLoad}
          onRefocusRequestLocation={() => void requestLocation({ showSplash: false })}
        />
      )}
      <Modal
        visible={locationFallbackModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <Pressable style={styles.locationFallbackOverlay} onPress={() => {
          setLocationFallbackModalVisible(false)
          setUserCoords(FALLBACK_COORDS)
          setRegion((prev) => prev ?? toRegionFromCoords(FALLBACK_COORDS))
          setLocationBooting(false)
        }}>
          <Pressable style={styles.locationFallbackCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.locationFallbackTitle}>Couldn't get your location</Text>
            <Pressable
              style={styles.locationFallbackBtn}
              onPress={() => {
                setUserCoords(FALLBACK_COORDS)
                setRegion((prev) => prev ?? toRegionFromCoords(FALLBACK_COORDS))
                setLocationBooting(false)
                setOpenHomeGateOnLoad(true)
                setLocationFallbackModalVisible(false)
              }}
            >
              <Text style={[styles.locationFallbackBtnText, styles.locationFallbackBtnPrimaryText]}>Set home address</Text>
            </Pressable>
            <Pressable
              style={[styles.locationFallbackBtn, styles.locationFallbackBtnSecondary]}
              onPress={() => {
                setUserCoords(FALLBACK_COORDS)
                setRegion((prev) => prev ?? toRegionFromCoords(FALLBACK_COORDS))
                setLocationBooting(false)
                setLocationFallbackModalVisible(false)
              }}
            >
              <Text style={styles.locationFallbackBtnText}>Use London</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  locationFallbackOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  locationFallbackCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    gap: 12,
  },
  locationFallbackTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  locationFallbackBtn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  locationFallbackBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  locationFallbackBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  locationFallbackBtnPrimaryText: {
    color: '#0a0a0a',
  },
  root: { flex: 1, backgroundColor: BG },
  toastHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 50,
    pointerEvents: 'box-none',
  },
  mapShell: { flex: 1, position: 'relative' },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height, backgroundColor: 'transparent' },
  bottomFilterSafeArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 72,
    elevation: 8,
    backgroundColor: 'transparent',
    pointerEvents: 'box-none',
  },
  bottomFloatingColumn: {
    flexDirection: 'column',
    gap: 10,
    alignItems: 'stretch',
  },
  bottomPromptSlot: {
    width: '100%',
  },
  filterGradient: {
    width: '100%',
    paddingTop: 20,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  poiLoadingStackBlock: {
    width: '100%',
  },
  poiLoadingTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
    /* Same legibility as MAP_OVERLAY_TEXT_SHADOW; tighter radius keeps blur from sitting "inside" glyphs. */
    ...MAP_OVERLAY_TEXT_SHADOW,
    textShadowRadius: 2,
  },
  poiLoadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(12,12,12,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  poiLoadingTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  poiLoadingFill: { height: '100%', borderRadius: 3, backgroundColor: ACCENT },
  searchWrap: {
    position: 'absolute',
    zIndex: 200,
    elevation: 30,
    left: 12,
    right: 12,
  },
  searchCard: {
    backgroundColor: 'transparent',
    zIndex: 200,
    elevation: 30,
  },
  searchInputWrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    minHeight: 44,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  filterRowCombined: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
    gap: 6,
    overflow: 'hidden',
  },
  chipsScroll: { flex: 1, minWidth: 0 },
  filterLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    marginRight: 4,
  },
  filterOptionsIcon: {
    ...MAP_OVERLAY_TEXT_SHADOW,
  },
  filterLabelText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    ...MAP_OVERLAY_TEXT_SHADOW,
  },
  filterAllNoneBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(20,20,20,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 0,
  },
  filterAllNoneBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    ...MAP_OVERLAY_TEXT_SHADOW,
  },
  chips: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    paddingBottom: 8,
    gap: 8,
    alignItems: 'center',
    flexDirection: 'row',
  },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: 'rgba(0,191,165,0.4)', borderWidth: 1, backgroundColor: SURFACE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipLabel: { color: ACCENT, fontSize: 11, fontWeight: '600' },
  chipLabelOn: { color: '#0a0a0a' },
  markerCaptureRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    minWidth: 80,
    minHeight: 80,
  },
  nudgePin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: POI_MAP_BLUE,
  },
  nudgeClusterMarkerRoot: {
    width: 140,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeClusterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 4,
    paddingLeft: 5,
    paddingRight: 9,
    borderWidth: 2,
    borderColor: POI_MAP_BLUE,
    gap: 5,
  },
  nudgeClusterLogoSlot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    marginRight: 2,
  },
  nudgeClusterIcons: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  nudgeClusterIconSlot: { marginHorizontal: -1 },
  nudgeClusterMoreTypes: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(10,22,36,0.78)',
    marginLeft: 2,
  },
  nudgeClusterCount: {
    color: POI_MAP_BLUE,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 18,
    textAlign: 'center',
  },
  poiClusterMarkerRoot: {
    width: 120,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poiPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: POI_MAP_BLUE,
    borderWidth: 2,
    borderColor: ACCENT,
  },
  poiClusterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: POI_MAP_BLUE,
    borderRadius: 999,
    paddingVertical: 5,
    paddingLeft: 7,
    paddingRight: 9,
    borderWidth: 2,
    borderColor: ACCENT,
    gap: 6,
  },
  poiClusterIcons: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  poiClusterIconSlot: { marginHorizontal: -1 },
  poiClusterMoreTypes: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(0,191,165,0.85)',
    marginLeft: 2,
  },
  poiClusterCount: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 18,
    textAlign: 'center',
  },
  homePin: { width: 24, height: 24, borderRadius: 12, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  userLocationPin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: ACCENT,
    borderWidth: 2,
    borderColor: '#fff',
  },
  searchAnchorPin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#f59e0b',
  },
  mapTypeBtn: {
    position: 'absolute',
    right: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapTypeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700', ...MAP_OVERLAY_TEXT_SHADOW },
  locateBtn: {
    position: 'absolute',
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  locateBtnOn: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  locateBtnOff: {
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderColor: 'rgba(255,255,255,0.24)',
  },
  tapDraftPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  tapPrompt: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,20,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 12,
    gap: 8,
  },
  tapPromptTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  tapPromptTitle: { color: '#fff', fontSize: 14, fontWeight: '700', ...MAP_OVERLAY_TEXT_SHADOW },
  tapPromptTitleInEditRow: { flex: 1, flexShrink: 1, marginRight: 8 },
  tapPromptDeleteIcon: {
    padding: 4,
  },
  tapPromptSliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tapPromptLabel: { color: MUTED, fontSize: 12, width: 44, ...MAP_OVERLAY_TEXT_SHADOW },
  tapPromptValue: {
    color: ACCENT,
    fontWeight: '700',
    fontSize: 12,
    width: 44,
    textAlign: 'right',
  },
  tapPromptActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  tapPromptCancel: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  tapPromptCancelText: { color: MUTED, fontWeight: '700', ...MAP_OVERLAY_TEXT_SHADOW },
  tapPromptAdd: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: ACCENT,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tapPromptAddText: { color: '#0a0a0a', fontWeight: '800' },
  mapPickBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapPickText: { color: '#fff', fontWeight: '700', ...MAP_OVERLAY_TEXT_SHADOW },
  mapPickCancel: { color: ACCENT, fontWeight: '700' },
  addHomeBtn: {
    alignSelf: 'flex-end',
    marginRight: 12,
    marginBottom: 6,
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addHomeBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 12 },
  leaveHomeQuick: {
    position: 'absolute',
    right: 12,
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leaveHomeQuickText: { color: '#0a0a0a', fontWeight: '800', fontSize: 12 },
})
