import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import type { SearchResult } from '../types'
import { AppLogo } from './AppLogo'

const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'
const SURFACE = '#141414'

type Variant = 'mapBar' | 'form'

type Props = {
  value?: string
  onChangeText?: (t: string) => void
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
  showMapClearButton?: boolean
  onSearchTextChange?: (t: string) => void
}

type NominatimResult = {
  lat: string
  lon: string
  name: string
  display_name: string
}

export function GooglePlacesAddressSearchField({
  value = '',
  onChangeText,
  onSelect,
  placeholder = 'Search places',
  enabled = true,
  variant,
  accentColor: _accentColor = ACCENT,
  surfaceColor = SURFACE,
  mapBarStyle,
  formInputStyle,
  mapLat,
  mapLng,
  showMapClearButton = true,
  onSearchTextChange,
}: Props) {
  const inputRef = useRef<TextInput>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMapBar = variant === 'mapBar'

  const [inputText, setInputText] = useState(value ?? '')
  const [results, setResults] = useState<NominatimResult[]>([])
  const [hasInputText, setHasInputText] = useState(false)

  useEffect(() => {
    setInputText(value ?? '')
    setHasInputText(Boolean(value?.trim()))
  }, [value])

  const emitText = (t: string) => {
    setHasInputText(Boolean(t.trim()))
    onChangeText?.(t)
    onSearchTextChange?.(t)
  }

  const handleChangeText = (t: string) => {
    console.log('handleChangeText called:', t)
    setInputText(t)
    emitText(t)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!t.trim() || t.trim().length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(t)}&limit=5&lang=en&osm_tag=!railway&osm_tag=!natural&lat=${mapLat}&lon=${mapLng}`
          console.log('Nominatim fetch starting for:', t)
          const res = await fetch(url)
          const json = (await res.json()) as { features: { geometry: { coordinates: [number, number] }; properties: { name?: string; city?: string; country?: string; street?: string; housenumber?: string } }[] }
          console.log('Nominatim raw response:', json)
          const data: NominatimResult[] = (json.features ?? []).map((feature) => ({
            lat: String(feature.geometry.coordinates[1]),
            lon: String(feature.geometry.coordinates[0]),
            name: feature.properties.name || feature.properties.street || feature.properties.city || '',
            display_name: [feature.properties.housenumber, feature.properties.street, feature.properties.name, feature.properties.city, feature.properties.country].filter(Boolean).join(', '),
          }))
          console.log('Nominatim results:', data.length)
          setResults(data)
        } catch (e) {
          console.log('Nominatim error:', e)
          setResults([])
        }
      })()
    }, 300)
  }

  const handleSelect = (item: NominatimResult) => {
    const lat = parseFloat(item.lat)
    const lng = parseFloat(item.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    onSelect({ lat, lng, name: item.name, display_name: item.display_name })
    setInputText('')
    setResults([])
    emitText('')
  }

  const handleClear = () => {
    setInputText('')
    setResults([])
    emitText('')
  }

  const textInput = (
    <TextInput
      ref={inputRef}
      value={inputText}
      onChangeText={handleChangeText}
      placeholder={placeholder}
      placeholderTextColor={MUTED}
      editable={enabled}
      autoCorrect={false}
      clearButtonMode="never"
      keyboardShouldPersistTaps="handled"
      style={[
        isMapBar ? styles.textInputMapBar : [styles.textInputForm, { backgroundColor: surfaceColor }, formInputStyle],
      ]}
      selectionColor="#fff"
      underlineColorAndroid="transparent"
    />
  )

  const dropdown =
    results.length > 0 ? (
      <FlatList
        style={styles.listView}
        keyboardShouldPersistTaps="handled"
        data={results}
        keyExtractor={(_, i) => String(i)}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => handleSelect(item)}>
            <Text style={styles.description} numberOfLines={2}>
              {item.display_name}
            </Text>
          </Pressable>
        )}
      />
    ) : null

  if (!isMapBar) {
    return (
      <View style={styles.formWrap} collapsable={false} pointerEvents="auto">
        {textInput}
        {dropdown}
      </View>
    )
  }

  return (
    <View
      style={[styles.wrap, styles.mapBarWrap, mapBarStyle, styles.mapBarRelative]}
      collapsable={false}
      pointerEvents="auto"
    >
      <View style={styles.mapBarInputSlot} collapsable={false}>
        <View style={styles.mapBarRow}>
          <Ionicons name="search-outline" size={18} color={_accentColor} style={styles.searchIcon} />
          {textInput}
        </View>
        {dropdown}
      </View>
      {showMapClearButton && hasInputText ? (
        <Pressable
          onPress={handleClear}
          hitSlop={10}
          style={styles.clearBtn}
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={20} color={MUTED} />
        </Pressable>
      ) : null}
      <View style={styles.mapBarLogoWrap} accessibilityLabel="Nudge" accessible>
        <AppLogo size={26} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 200,
    elevation: 30,
  },
  mapBarRelative: {
    position: 'relative',
    zIndex: 200,
  },
  mapBarInputSlot: {
    flex: 1,
    minWidth: 0,
  },
  mapBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapBarWrap: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    minHeight: 44,
  },
  formWrap: {
    backgroundColor: 'transparent',
    zIndex: 200,
    elevation: 30,
    position: 'relative',
  },
  searchIcon: {
    marginRight: 4,
  },
  mapBarLogoWrap: {
    marginLeft: 4,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearBtn: {
    padding: 2,
    marginLeft: 4,
    flexShrink: 0,
  },
  textInputMapBar: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    height: 40,
    paddingHorizontal: 4,
  },
  textInputForm: {
    color: '#fff',
    fontSize: 16,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
  },
  listView: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginTop: 4,
    zIndex: 300,
    elevation: 30,
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    maxHeight: 260,
  },
  row: {
    backgroundColor: SURFACE,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  description: {
    color: '#fff',
    fontSize: 13,
  },
  separator: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    height: StyleSheet.hairlineWidth,
  },
})
