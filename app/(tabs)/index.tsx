import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import Slider from '@react-native-community/slider'
import type { User } from '@supabase/supabase-js'
import { useIsFocused } from '@react-navigation/native'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import MapView, { Circle, Marker, UrlTile, type MapPressEvent, type Region } from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HomeLocationGateModal, type HomeDraft } from '../../components/HomeLocationGateModal'
import { GooglePlacesAddressSearchField } from '../../components/GooglePlacesAddressSearchField'
import { AppTiledBackground } from '../../components/AppTiledBackground'
import { AppStartupSplash } from '../../components/AppStartupSplash'
import NudgeModal, { type NudgeSavePayload } from '../../components/NudgeModal'
import { CategoryIcon } from '../../components/CategoryIcon'
import { useAuth } from '../../context/AuthContext'
import { useLeavingHomePrompt } from '../../context/LeavingHomePromptContext'
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/categories'
import { distanceMetres } from '../../lib/geo'
import { fetchUserHome, upsertUserHome, type UserHomeRow } from '../../lib/home-queries'
import { isValidMapRegionForFetch, regionShowsPoiMarkers } from '../../lib/map-poi-zoom'
import {
  createLeavingHomeNudgeIfAbsent,
  deleteNudgeForUser,
  fetchUserNudges,
  hasLeavingHomeNudge,
  updateNudgeForUser,
  type NudgeListItem,
} from '../../lib/nudge-queries'
import { loadDefaultRadiusMeters, loadMapStylePreference, saveMapStylePreference } from '../../lib/user-preferences'
import { peekPoiAreaCache, poiAreaCacheKey, putPoiAreaCache, touchAndReadPoiAreaCache } from '../../lib/poi-cache-db'
import { clusterMapPois, getClusterCategoryRows, getClusterPillCategories } from '../../lib/poi-cluster'
import {
  fetchNearbyPoisSequential,
  filterPoisAwayFromNudges,
  type MapPoi,
  type PoiFetchProgressInfo,
} from '../../lib/poi-fetch'
import { supabase } from '../../lib/supabase'
import { effectiveUserId } from '../../lib/dev-user'

const BG = '#0a0a0a'
const SURFACE = '#141414'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'
const TILE_OSM_FR_HOT = 'https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png'

const MAP_OVERLAY_TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.8)',
  textShadowOffset: { width: 1, height: 1 } as const,
  textShadowRadius: 3,
}

const LOCATION_TIMEOUT_MS = 10_000
const FALLBACK_COORDS = { lat: 51.8784, lng: 0.5522 } // Braintree

/** POI refetch only if the map centre has moved this far from {@link lastPoiFetchCenterRef} (onRegionChangeComplete). */
const POI_FETCH_MIN_MOVE_M = 500

/** Avoid publishing `region` to React state on every tiny settle — reduces MapView/marker re-renders. */
const MIN_REGION_PUBLISH_MOVE_M = 80

/** Custom nudge pins need bitmap updates to show {@link CategoryIcon} reliably. */
const MARKER_TRACKS_NUDGE_CHANGES = true
/** POI/cluster markers use custom child views. */
const MARKER_TRACKS_POI_CHANGES = true
/** Default pins / simple markers — avoid unnecessary native view sync. */
const MARKER_TRACKS_SIMPLE = false

function toRegionFromCoords(coords: { lat: number; lng: number }): Region {
  return {
    latitude: coords.lat,
    longitude: coords.lng,
    latitudeDelta: 0.015,
    longitudeDelta: 0.015,
  }
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

const nudgePinMarkerStyle = {
  width: 28,
  height: 28,
  borderRadius: 14,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: ACCENT,
  borderWidth: 1,
  borderColor: '#0a0a0a',
}

function PoiClusterPill({ members }: { members: MapPoi[] }) {
  const rows = getClusterCategoryRows(members)
  const { top, moreCategoryTypes } = getClusterPillCategories(rows)
  const distinctCategories = rows.length
  const n = members.length
  const showTotalBadge = n > 1 && (distinctCategories > 1 || moreCategoryTypes > 0)

  return (
    <View style={styles.clusterPill}>
      {top.map((row, idx) => (
        <View key={`${row.category}-${idx}`} style={styles.clusterPillIconSlot}>
          <CategoryIcon category={row.category} size={13} color="#fff" />
          {row.count > 1 ? <Text style={styles.clusterPillTypeCount}>{row.count}</Text> : null}
        </View>
      ))}
      {moreCategoryTypes > 0 ? (
        <Text style={styles.clusterPillOverflow}>+{moreCategoryTypes}</Text>
      ) : null}
      {showTotalBadge ? <Text style={styles.clusterPillCount}>{n}</Text> : null}
    </View>
  )
}

const MapNudgeMarker = memo(
  function MapNudgeMarkerFn({
    nudge,
    onPress,
  }: {
    nudge: NudgeListItem
    onPress: (n: NudgeListItem) => void
  }) {
    return (
      <Marker
        coordinate={{ latitude: nudge.lat, longitude: nudge.lng }}
        tracksViewChanges={MARKER_TRACKS_NUDGE_CHANGES}
        onPress={() => onPress(nudge)}
      >
        <View style={nudgePinMarkerStyle} collapsable={false}>
          <CategoryIcon category={nudge.category} size={16} color="#0a0a0a" />
        </View>
      </Marker>
    )
  },
  (a, b) =>
    a.nudge.id === b.nudge.id &&
    a.nudge.lat === b.nudge.lat &&
    a.nudge.lng === b.nudge.lng &&
    a.nudge.category === b.nudge.category &&
    a.onPress === b.onPress,
)

type MapScreenBodyProps = {
  /** Null when auth is bypassed for development. */
  user: User | null
  insets: ReturnType<typeof useSafeAreaInsets>
  initialRegion: Region
  initialUserCoords: { lat: number; lng: number }
  onRefocusRequestLocation: () => void
}

/** All hooks run unconditionally at the top level; no returns before hooks complete. */
function MapScreenBody({
  user,
  insets,
  initialRegion,
  initialUserCoords,
  onRefocusRequestLocation,
}: MapScreenBodyProps) {
  const { registerLeavingHomeComposeHandler, invalidateLeavingHomePromptCheck } = useLeavingHomePrompt()
  const isFocused = useIsFocused()

  const [userCoords, setUserCoords] = useState(initialUserCoords)
  const [region, setRegion] = useState<Region>(initialRegion)
  const [mapStyle, setMapStyle] = useState<'standard' | 'satellite'>('standard')
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(CATEGORIES))
  const [nudges, setNudges] = useState<Awaited<ReturnType<typeof fetchUserNudges>>['data']>([])
  const [homeRow, setHomeRow] = useState<UserHomeRow | null>(null)
  const [nudgeModalOpen, setNudgeModalOpen] = useState(false)
  const [editNudge, setEditNudge] = useState<(typeof nudges)[number] | null>(null)
  const [pendingCreate, setPendingCreate] = useState<{ lat: number; lng: number; title?: string; category?: string } | null>(null)
  const [tapDraft, setTapDraft] = useState<{ lat: number; lng: number; title?: string; category?: string } | null>(null)
  const [nudgeEditPrompt, setNudgeEditPrompt] = useState<(typeof nudges)[number] | null>(null)
  const [radiusMeters, setRadiusMeters] = useState(25)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchAnchor, setSearchAnchor] = useState<{ lat: number; lng: number } | null>(null)
  const [homeGateOpen, setHomeGateOpen] = useState(false)
  const [homeGateChecked, setHomeGateChecked] = useState(false)
  const [homeDraft, setHomeDraft] = useState<HomeDraft | null>(null)
  const [homeMapPickActive, setHomeMapPickActive] = useState(false)
  const [homeSearchQuery, setHomeSearchQuery] = useState('')
  const [homeSaving, setHomeSaving] = useState(false)
  const [pois, setPois] = useState<MapPoi[]>([])
  const [poiProgress, setPoiProgress] = useState(0)
  /** True from POI fetch start until batch applied or run ends (covers progress 0 steps). */
  const [poiFetchActive, setPoiFetchActive] = useState(false)
  const [isMapCenteredOnUser, setIsMapCenteredOnUser] = useState(true)
  const [hasHomeLeaveNudge, setHasHomeLeaveNudge] = useState(false)
  const mapRef = useRef<MapView | null>(null)
  const poiAbortRef = useRef<AbortController | null>(null)
  const mapInitialRegionRef = useRef<Region | null>(null)
  const homeGateDismissedRef = useRef(false)
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

  useEffect(() => {
    setUserCoords(initialUserCoords)
  }, [initialUserCoords])
  useEffect(() => {
    setRegion(initialRegion)
  }, [initialRegion])

  const applyPoisBatch = useCallback((all: MapPoi[]) => {
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
    const [nRes, hRes, defaultRadius, style] = await Promise.all([
      fetchUserNudges(uid),
      fetchUserHome(uid),
      loadDefaultRadiusMeters(),
      loadMapStylePreference(),
    ])
    if (!nRes.error) setNudges(nRes.data)
    if (!hRes.error) setHomeRow(hRes.data)
    if (!hRes.error && hRes.data?.id) {
      const leaveExists = await hasLeavingHomeNudge(uid, hRes.data.id)
      setHasHomeLeaveNudge(leaveExists)
    } else {
      setHasHomeLeaveNudge(false)
    }
    setRadiusMeters(defaultRadius)
    setMapStyle(style)
    setHomeGateChecked(true)
  }, [user?.id])

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
        if (!isValidMapRegionForFetch(r)) return

        if (!regionShowsPoiMarkers(r)) {
          poiAbortRef.current?.abort()
          poiAbortRef.current = null
          setPoiFetchActive(false)
          setPois([])
          setPoiProgress(0)
          lastPoiFetchCenterRef.current = null
          lastPoiFetchAreaKeyRef.current = null
          return
        }

        const center = { lat: r.latitude, lng: r.longitude }
        const areaKey = poiAreaCacheKey(center.lat, center.lng)
        const prevCenter = lastPoiFetchCenterRef.current
        const movedM = prevCenter == null ? null : distanceMetres(center, prevCenter)
        const sameAreaBucket =
          lastPoiFetchAreaKeyRef.current != null && lastPoiFetchAreaKeyRef.current === areaKey

        /* Only skip when still in same 2dp tile *and* centre barely moved — otherwise refresh/cache new tile. */
        if (!opts?.force && prevCenter != null && movedM != null && movedM < POI_FETCH_MIN_MOVE_M && sameAreaBucket) {
          console.log('[POI] skip (same cache bucket, moved < 500m)', {
            areaKey,
            movedM: Math.round(movedM),
          })
          return
        }

        lastPoiFetchCenterRef.current = center

        poiAbortRef.current?.abort()
        poiAbortRef.current = null

        const perQueryLimit = 50
        const span = Math.max(r.latitudeDelta, r.longitudeDelta)
        const nudgeCoords = nudges.map((n) => ({ lat: n.lat, lng: n.lng }))

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

          return fetchNearbyPoisSequential(
            center.lat,
            center.lng,
            nudgeCoords,
            ac.signal,
            silent ? undefined : onPoiProgress,
            (batch) => {
              const filtered = filterPoisAwayFromNudges(batch, nudgeCoords)
              if (silent) {
                setPois(filtered)
              } else {
                applyPoisBatch(filtered)
              }
              lastPoiFetchAreaKeyRef.current = areaKey
              void putPoiAreaCache(areaKey, filtered)
            },
            silent ? undefined : () => setPoiProgress(1),
            perQueryLimit,
          )
        }

        if (!opts?.force) {
          try {
            const cachedRow = await touchAndReadPoiAreaCache(areaKey)
            if (cachedRow) {
              const filtered = filterPoisAwayFromNudges(cachedRow.pois, nudgeCoords)
              console.log('[POI cache] HIT', {
                areaKey,
                visitCount: cachedRow.visitCount,
                poiCount: filtered.length,
              })
              setPois(filtered)
              setPoiFetchActive(false)
              setPoiProgress(1)
              lastPoiFetchAreaKeyRef.current = areaKey
              const vc = cachedRow.visitCount
              if (vc % 10 !== 0) {
                return
              }
              await runNetworkFetch(true)
              setPoiProgress(1)
              return
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
    [nudges, onPoiProgress, applyPoisBatch],
  )

  /** Refetch POIs when nudges change (near-nudge filtering). Skipped when zoomed out. */
  useEffect(() => {
    const r = stableMapRegionRef.current
    if (!r || !isValidMapRegionForFetch(r) || !regionShowsPoiMarkers(r)) return
    lastPoiFetchCenterRef.current = null
    lastPoiFetchAreaKeyRef.current = null
    maybeFetchPoisForRegion(r, { force: true })
  }, [nudges, maybeFetchPoisForRegion])

  /**
   * Pre-fetch POIs for the home location tile (`lib/poi-fetch`, OSM/Nominatim for POI pins only).
   * Address search uses Google Places only.
   */
  useEffect(() => {
    if (!homeRow) return

    const areaKey = poiAreaCacheKey(homeRow.lat, homeRow.lng)
    const nudgeCoords = nudges
      .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
      .map((n) => ({ lat: n.lat, lng: n.lng }))

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
            void putPoiAreaCache(areaKey, filtered)
          },
          undefined,
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
  }, [homeRow?.id, homeRow?.lat, homeRow?.lng, nudges])

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

  const filteredPois = useMemo(
    () => pois.filter((p) => activeCategories.has(p.category)),
    [pois, activeCategories],
  )

  const clusteredPois = useMemo(() => clusterMapPois(filteredPois), [filteredPois])

  const allFiltersActive = useMemo(() => CATEGORIES.every((c) => activeCategories.has(c)), [activeCategories])

  const toggleAllCategoryFilters = useCallback(() => {
    setActiveCategories((prev) => {
      const everyOn = CATEGORIES.every((c) => prev.has(c))
      if (everyOn) return new Set()
      return new Set(CATEGORIES)
    })
  }, [])

  useEffect(() => {
    const items = clusterMapPois(filteredPois)
    let poiClusterIndividualCount = 0
    let poiClusterGroupCount = 0
    const firstThreeClusterCoords: { centerLat: number; centerLng: number }[] = []
    for (const item of items) {
      if (item.kind === 'single') {
        poiClusterIndividualCount += 1
      } else {
        poiClusterGroupCount += 1
        if (firstThreeClusterCoords.length < 3) {
          firstThreeClusterCoords.push({ centerLat: item.centerLat, centerLng: item.centerLng })
        }
      }
    }
    console.log('[Map] clusteredPois (pois changed)', {
      poisLength: filteredPois.length,
      individuals: poiClusterIndividualCount,
      clusters: poiClusterGroupCount,
      totalRenderItems: items.length,
      firstThreeClusterCoords,
      firstThreeFiniteCheck: firstThreeClusterCoords.map((c) => ({
        centerLat: c.centerLat,
        centerLng: c.centerLng,
        latFinite: Number.isFinite(c.centerLat),
        lngFinite: Number.isFinite(c.centerLng),
      })),
    })
  }, [filteredPois])

  const onNudgeMarkerPress = useCallback((n: NudgeListItem) => {
    setNudgeEditPrompt(n)
  }, [])

  const handleMapPress = useCallback(
    (e: MapPressEvent) => {
      const c = e.nativeEvent.coordinate
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return
      if (homeMapPickActive) {
        setHomeDraft((prev) => ({
          lat: c.latitude,
          lng: c.longitude,
          name: prev?.name?.trim() || 'Home',
        }))
        setHomeMapPickActive(false)
        return
      }
      setNudgeEditPrompt(null)
      setSearchAnchor(null)
      setTapDraft({ lat: c.latitude, lng: c.longitude, category: '⭐' })
      mapRef.current?.animateToRegion(
        {
          latitude: c.latitude,
          longitude: c.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        280,
      )
    },
    [homeMapPickActive],
  )

  const handleRegionChangeComplete = useCallback(
    (r: Region) => {
      stableMapRegionRef.current = r
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
          await refreshAll()
          setNudgeModalOpen(false)
          setEditNudge(null)
          setPendingCreate(null)
          setTapDraft(null)
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
      } else {
        await refreshAll()
        setNudgeModalOpen(false)
        setPendingCreate(null)
        setEditNudge(null)
        setTapDraft(null)
      }
    },
    [refreshAll, user?.id],
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
            if (!res.error) await refreshAll()
          },
        },
      ])
    },
    [refreshAll, user?.id],
  )

  if (!mapInitialRegionRef.current) {
    mapInitialRegionRef.current = region
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
      <Text style={styles.tapPromptTitle}>Edit this nudge?</Text>
      <View style={styles.tapPromptActions}>
        <Pressable style={styles.tapPromptCancel} onPress={() => setNudgeEditPrompt(null)}>
          <Text style={styles.tapPromptCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.tapPromptAdd}
          onPress={() => {
            const n = nudgeEditPrompt
            if (!n) return
            setEditNudge(n)
            setRadiusMeters(n.radius_meters)
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
    <AppTiledBackground>
      <View style={styles.root}>
      <View style={styles.mapShell}>
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType={mapStyle}
          mapPadding={{
            top: 0,
            right: 0,
            left: 0,
            bottom: 60,
          }}
          toolbarEnabled={false}
          initialRegion={mapInitialRegionRef.current}
          onRegionChangeComplete={handleRegionChangeComplete}
          onPress={handleMapPress}
          userInterfaceStyle="dark"
        >
        {mapStyle === 'standard' ? <UrlTile urlTemplate={TILE_OSM_FR_HOT} maximumZ={19} flipY={false} /> : null}
        <Marker
          coordinate={{ latitude: userCoords.lat, longitude: userCoords.lng }}
          pinColor={ACCENT}
          tracksViewChanges={MARKER_TRACKS_SIMPLE}
        />
        {homeRow ? (
          <>
            <Circle
              center={{ latitude: homeRow.lat, longitude: homeRow.lng }}
              radius={homeRow.radius_meters}
              fillColor="rgba(0,191,165,0.10)"
              strokeColor="rgba(0,191,165,0.8)"
            />
            <Marker
              coordinate={{ latitude: homeRow.lat, longitude: homeRow.lng }}
              title={homeRow.name}
              tracksViewChanges={MARKER_TRACKS_SIMPLE}
            >
              <View style={styles.homePin}><Ionicons name="home" size={14} color="#0a0a0a" /></View>
            </Marker>
          </>
        ) : null}
        {nudgesOnMap.map((n) => (
          <Circle
            key={`nudge-zone-${n.id}`}
            center={{ latitude: n.lat, longitude: n.lng }}
            radius={Math.max(1, Number(n.radius_meters) || 25)}
            fillColor="rgba(0,191,165,0.15)"
            strokeColor="rgba(0,191,165,0.8)"
            strokeWidth={2}
          />
        ))}
        {nudgesOnMap.map((n) => (
          <MapNudgeMarker key={n.id} nudge={n} onPress={onNudgeMarkerPress} />
        ))}
        {clusteredPois.map((item) =>
          item.kind === 'single' ? (
            <Marker
              key={item.key}
              coordinate={{ latitude: item.poi.lat, longitude: item.poi.lng }}
              title={item.poi.label}
              tracksViewChanges={MARKER_TRACKS_POI_CHANGES}
              onPress={() => {
                setNudgeEditPrompt(null)
                setTapDraft({
                  lat: item.poi.lat,
                  lng: item.poi.lng,
                  title: item.poi.label,
                  category: item.poi.category,
                })
                mapRef.current?.animateToRegion(
                  {
                    latitude: item.poi.lat,
                    longitude: item.poi.lng,
                    latitudeDelta: 0.008,
                    longitudeDelta: 0.008,
                  },
                  280,
                )
              }}
            >
              <View style={styles.poiPin}>
                <CategoryIcon category={item.poi.category} size={14} color={ACCENT} />
              </View>
            </Marker>
          ) : (
            <Marker
              key={item.key}
              coordinate={{ latitude: item.centerLat, longitude: item.centerLng }}
              tracksViewChanges={MARKER_TRACKS_POI_CHANGES}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => {
                setNudgeEditPrompt(null)
                const snap = stableMapRegionRef.current
                const latD = snap?.latitudeDelta ?? mapSpanLatDelta
                const lngD = snap?.longitudeDelta ?? mapSpanLngDelta
                mapRef.current?.animateToRegion(
                  {
                    latitude: item.centerLat,
                    longitude: item.centerLng,
                    latitudeDelta: Math.max(0.0025, latD * 0.5),
                    longitudeDelta: Math.max(0.0025, lngD * 0.5),
                  },
                  260,
                )
              }}
            >
              <View style={styles.poiClusterMarkerCanvas} collapsable={false} pointerEvents="box-none">
                <View style={styles.poiClusterMarkerPillWrap} collapsable={false}>
                  <PoiClusterPill members={item.members} />
                </View>
              </View>
            </Marker>
          ),
        )}
        {searchAnchor ? (
          <Marker coordinate={{ latitude: searchAnchor.lat, longitude: searchAnchor.lng }} pinColor="#f59e0b" />
        ) : null}
        {tapDraft ? (
          <>
            <Circle
              center={{ latitude: tapDraft.lat, longitude: tapDraft.lng }}
              radius={radiusMeters}
              fillColor="rgba(0,191,165,0.18)"
              strokeColor="rgba(0,191,165,0.95)"
            />
            <Marker coordinate={{ latitude: tapDraft.lat, longitude: tapDraft.lng }}>
              <View style={styles.tapDraftPin}>
                <Ionicons name="add" size={14} color="#fff" />
              </View>
            </Marker>
          </>
        ) : null}
      </MapView>
      </View>
      <View style={[styles.searchWrap, { top: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.searchCard}>
          <GooglePlacesAddressSearchField
            variant="mapBar"
            value={searchQuery}
            onChangeText={(t) => {
              setSearchQuery(t)
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
              setSearchQuery('')
              setSearchAnchor({ lat: r.lat, lng: r.lng })
              setPendingCreate({
                lat: r.lat,
                lng: r.lng,
                title: (r.display_name || r.name).trim(),
                category: '⭐',
              })
              mapRef.current?.animateToRegion(
                {
                  latitude: r.lat,
                  longitude: r.lng,
                  latitudeDelta: 0.014,
                  longitudeDelta: 0.014,
                },
                350,
              )
            }}
          />
        </View>
      </View>

      <View
        style={[
          styles.bottomFloatingChrome,
          {
            bottom: Math.max(4, insets.bottom + 4),
            paddingRight: 12,
            paddingLeft: 12,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.bottomFloatingColumn} pointerEvents="box-none">
          {bottomPromptCard ? (
            <View style={styles.bottomPromptSlot} pointerEvents="auto">
              {bottomPromptCard}
            </View>
          ) : null}
          {showPoiLoadingStrip ? (
            <View style={styles.poiLoadingStackBlock} pointerEvents="none">
              <Text style={styles.poiLoadingTitle}>Loading nearby places...</Text>
              <View style={styles.poiLoadingCard}>
                <ActivityIndicator color={ACCENT} size="small" />
                <View style={styles.poiLoadingTrack}>
                  <View style={[styles.poiLoadingFill, { width: `${poiLoadingBarPct}%` }]} />
                </View>
              </View>
            </View>
          ) : null}
          <View style={styles.controlsInner} pointerEvents="box-none">
            <View style={styles.filterRowCombined}>
              <Pressable onPress={toggleAllCategoryFilters} style={styles.filterAllNoneBtn} hitSlop={6}>
                <Text style={styles.filterAllNoneBtnText}>{allFiltersActive ? 'None' : 'All'}</Text>
              </Pressable>
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
              <View style={styles.filterLabelRow} pointerEvents="none">
                <Ionicons name="options-outline" size={17} color="#fff" style={styles.filterOptionsIcon} />
                <Text style={styles.filterLabelText}>Filter</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
      <Pressable
        style={[
          styles.locateBtn,
          isMapCenteredOnUser ? styles.locateBtnOn : styles.locateBtnOff,
          { top: insets.top + 104 },
        ]}
        onPress={async () => {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }).catch(() => null)
          const coords = pos
            ? { lat: pos.coords.latitude, lng: pos.coords.longitude }
            : FALLBACK_COORDS
          setUserCoords(coords)
          const next = {
            latitude: coords.lat,
            longitude: coords.lng,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          }
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
              mapRef.current?.animateToRegion(next, 400)
            })
          })
          setIsMapCenteredOnUser(true)
        }}
      >
        <Ionicons name="locate" size={16} color={isMapCenteredOnUser ? '#0a0a0a' : '#fff'} />
      </Pressable>
      <Pressable
        style={[styles.mapTypeBtn, { top: insets.top + 56 }]}
        onPress={() => {
          const next = mapStyle === 'standard' ? 'satellite' : 'standard'
          setMapStyle(next)
          void saveMapStylePreference(next)
        }}
      >
        <Ionicons name={mapStyle === 'standard' ? 'layers-outline' : 'map-outline'} size={17} color="#fff" />
        <Text style={styles.mapTypeBtnText}>{mapStyle === 'standard' ? 'Satellite' : 'Map'}</Text>
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
          homeGateDismissedRef.current = true
        }}
        onStartMapPick={() => {
          setHomeMapPickActive(true)
          setHomeGateOpen(false)
        }}
        onSave={async () => {
          if (!user?.id || !homeDraft) return
          setHomeSaving(true)
          const res = await upsertUserHome(user.id, {
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
        searchQuery={homeSearchQuery}
        onSearchQueryChange={setHomeSearchQuery}
        onSelectSearchResult={(r) => {
          setHomeDraft({
            lat: r.lat,
            lng: r.lng,
            name: (r.display_name || r.name).trim() || 'Home',
          })
          setHomeSearchQuery('')
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
          style={[styles.leaveHomeQuick, { bottom: insets.bottom + 152 }]}
          onPress={async () => {
            if (!user?.id) return
            const r = await createLeavingHomeNudgeIfAbsent(user.id, homeRow.id, homeRow.radius_meters)
            if (!r.error) await refreshAll()
          }}
        >
          <Ionicons name="log-out-outline" size={16} color="#0a0a0a" />
          <Text style={styles.leaveHomeQuickText}>Add leaving-home nudge</Text>
        </Pressable>
      ) : null}
      </View>
    </AppTiledBackground>
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
  const hasDoneInitialLocationBootRef = useRef(false)

  const requestLocation = useCallback(async (opts?: { showSplash?: boolean }) => {
    if (opts?.showSplash) setLocationBooting(true)
    let resolvedCoords = FALLBACK_COORDS
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
          const pos = await getCurrentPositionWithTimeout(LOCATION_TIMEOUT_MS)
          if (pos?.coords && Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude)) {
            resolvedCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          }
        }
      }
    } finally {
      setUserCoords(resolvedCoords)
      setRegion((prev) => prev ?? toRegionFromCoords(resolvedCoords))
      setLocationBooting(false)
    }
  }, [])

  useEffect(() => {
    if (!isFocused) return
    if (!hasDoneInitialLocationBootRef.current) {
      hasDoneInitialLocationBootRef.current = true
      void requestLocation({ showSplash: true })
      return
    }
    void requestLocation({ showSplash: false })
  }, [isFocused, requestLocation])

  // TODO: Re-enable auth before launch.
  // if (!user) return <AppStartupSplash message="Loading your account…" />
  if (locationBooting || !userCoords || !region) return <AppStartupSplash message="Getting your location…" />

  return (
    <MapScreenBody
      user={user}
      insets={insets}
      initialRegion={region}
      initialUserCoords={userCoords}
      onRefocusRequestLocation={() => void requestLocation({ showSplash: false })}
    />
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  mapShell: { flex: 1, position: 'relative' },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bottomFloatingChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 72,
    elevation: 14,
  },
  bottomFloatingColumn: {
    flexDirection: 'column',
    gap: 10,
    alignItems: 'stretch',
  },
  bottomPromptSlot: {
    width: '100%',
  },
  controlsInner: {
    width: '100%',
  },
  poiLoadingStackBlock: {
    width: '100%',
  },
  poiLoadingTitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
    ...MAP_OVERLAY_TEXT_SHADOW,
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
    paddingHorizontal: 8,
    paddingBottom: 4,
    gap: 8,
  },
  chipsScroll: { flex: 1, flexGrow: 1, minWidth: 0 },
  filterLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
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
  chips: { paddingHorizontal: 4, gap: 8, alignItems: 'center', flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: 'rgba(0,191,165,0.4)', borderWidth: 1, backgroundColor: SURFACE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipLabel: { color: ACCENT, fontSize: 11, fontWeight: '600' },
  chipLabelOn: { color: '#0a0a0a' },
  nudgePin: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderWidth: 1, borderColor: '#0a0a0a' },
  poiPin: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,20,20,0.95)', borderWidth: 1, borderColor: 'rgba(0,191,165,0.6)' },
  homePin: { width: 24, height: 24, borderRadius: 12, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  /** Wide fixed canvas: react-native-maps Marker clips custom views; extra width avoids right-side truncation. */
  poiClusterMarkerCanvas: {
    width: 280,
    height: 48,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  poiClusterMarkerPillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  clusterPill: {
    minHeight: 32,
    minWidth: 56,
    borderRadius: 999,
    overflow: 'visible',
    flexShrink: 0,
    width: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 5,
    backgroundColor: ACCENT,
    borderWidth: 1,
    borderColor: '#fff',
    alignSelf: 'center',
  },
  clusterPillIconSlot: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  clusterPillTypeCount: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    includeFontPadding: false,
    ...MAP_OVERLAY_TEXT_SHADOW,
  },
  clusterPillOverflow: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    marginLeft: 2,
    includeFontPadding: false,
    ...MAP_OVERLAY_TEXT_SHADOW,
  },
  clusterPillCount: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    marginLeft: 4,
    includeFontPadding: false,
    ...MAP_OVERLAY_TEXT_SHADOW,
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
  tapPromptTitle: { color: '#fff', fontSize: 14, fontWeight: '700', ...MAP_OVERLAY_TEXT_SHADOW },
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
