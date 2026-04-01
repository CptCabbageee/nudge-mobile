import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { fetchGooglePlaceAutocompleteSuggestions, fetchGooglePlaceDetails } from '../lib/google-places'
import type { SearchResult } from '../types'

const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'
const SURFACE = '#141414'

const MAP_OVERLAY_TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.8)',
  textShadowOffset: { width: 1, height: 1 } as const,
  textShadowRadius: 3,
}

const DEBOUNCE_MS = 400
const MIN_CHARS = 2

type Variant = 'mapBar' | 'form'

type Props = {
  value: string
  onChangeText: (t: string) => void
  onSelect: (r: SearchResult) => void
  placeholder?: string
  enabled?: boolean
  variant: Variant
  accentColor?: string
  surfaceColor?: string
  mapBarStyle?: StyleProp<ViewStyle>
  formInputStyle?: StyleProp<TextStyle>
  mapLat: number
  mapLng: number
  /** Map bar only: show clear (X) when there is text. */
  showMapClearButton?: boolean
}

type GoogleSuggestion = {
  placeId: string
  description: string
}

/** Google Places Autocomplete + Details only (no Nominatim). Suggestions render as plain Views, not FlatList. */
export function GooglePlacesAddressSearchField({
  value,
  onChangeText,
  onSelect,
  placeholder = 'Search places',
  enabled = true,
  variant,
  accentColor = ACCENT,
  surfaceColor = SURFACE,
  mapBarStyle,
  formInputStyle,
  mapLat,
  mapLng,
  showMapClearButton = true,
}: Props) {
  const [results, setResults] = useState<GoogleSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const mapCenterRef = useRef({ lat: mapLat, lng: mapLng })
  mapCenterRef.current = { lat: mapLat, lng: mapLng }

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort()
      setResults([])
      setLoading(false)
      return
    }

    const q = value.trim()
    if (q.length < MIN_CHARS) {
      abortRef.current?.abort()
      setResults([])
      setLoading(false)
      return
    }

    const ac = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ac
    setLoading(true)

    const timer = setTimeout(() => {
      const { lat, lng } = mapCenterRef.current
      void fetchGooglePlaceAutocompleteSuggestions(q, lat, lng, ac.signal)
        .then((rows) => {
          if (!ac.signal.aborted) setResults(rows)
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [value, enabled])

  const onPick = useCallback(
    async (r: GoogleSuggestion) => {
      setResults([])
      const ac = new AbortController()
      try {
        setLoading(true)
        const details = await fetchGooglePlaceDetails(r.placeId, ac.signal)
        if (!details) return
        onSelect(details)
      } finally {
        setLoading(false)
      }
    },
    [onSelect],
  )

  const showClear =
    variant === 'mapBar' && showMapClearButton && typeof value === 'string' && value.length > 0

  const suggestionRows =
    results.length > 0 || loading ? (
      <View style={styles.dropdown} collapsable={false}>
        {loading ? (
          <View style={styles.listHeader}>
            <ActivityIndicator color={accentColor} size="small" />
          </View>
        ) : null}
        {results.length === 0 && !loading ? (
          <View style={styles.emptyPad}>
            <Text style={styles.emptyText}>No results</Text>
          </View>
        ) : (
          results.map((item, index) => (
            <Pressable
              key={`${item.placeId}:${index}`}
              style={styles.row}
              onPress={() => void onPick(item)}
              android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
            >
              <Text style={styles.rowText} numberOfLines={3}>
                {item.description}
              </Text>
            </Pressable>
          ))
        )}
      </View>
    ) : null

  if (variant === 'mapBar') {
    return (
      <View style={styles.mapBarWrap}>
        <View style={[styles.mapBar, { backgroundColor: surfaceColor, borderColor: 'rgba(255,255,255,0.2)' }, mapBarStyle]}>
          <Ionicons name="search-outline" size={18} color={MUTED} />
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={MUTED}
            style={styles.mapInput}
            autoCorrect={false}
          />
          {showClear ? (
            <Pressable
              onPress={() => {
                onChangeText('')
                setResults([])
              }}
              hitSlop={10}
              style={styles.clearBtn}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={MUTED} />
            </Pressable>
          ) : null}
          {loading && results.length === 0 ? <ActivityIndicator color={accentColor} size="small" /> : null}
        </View>
        {suggestionRows}
      </View>
    )
  }

  return (
    <View collapsable={false} style={styles.formWrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        style={[
          styles.formInput,
          { backgroundColor: surfaceColor, borderColor: 'rgba(255,255,255,0.2)', color: '#fff' },
          formInputStyle,
        ]}
        autoCorrect={false}
      />
      {loading && results.length === 0 ? (
        <ActivityIndicator color={accentColor} style={{ marginVertical: 8 }} />
      ) : null}
      {suggestionRows}
    </View>
  )
}

const styles = StyleSheet.create({
  mapBarWrap: { zIndex: 200, elevation: 30 },
  formWrap: { zIndex: 200, elevation: 30 },
  mapBar: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    minHeight: 44,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  clearBtn: { padding: 2 },
  mapInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 10, ...MAP_OVERLAY_TEXT_SHADOW },
  formInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  dropdown: {
    zIndex: 200,
    elevation: 30,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginTop: 6,
    maxHeight: 220,
    overflow: 'hidden',
  },
  listHeader: { paddingVertical: 8, alignItems: 'center' },
  emptyPad: { padding: 12 },
  emptyText: { color: MUTED, fontSize: 13 },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  rowText: { color: '#fff', fontSize: 13 },
})
