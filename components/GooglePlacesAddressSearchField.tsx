import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import {
  GooglePlacesAutocomplete,
  type GooglePlacesAutocompleteRef,
} from 'react-native-google-places-autocomplete'
import type { SearchResult } from '../types'

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
  const ref = useRef<GooglePlacesAutocompleteRef>(null)
  const isMapBar = variant === 'mapBar'
  const [hasInputText, setHasInputText] = useState(false)

  const apiKey = (Constants.expoConfig?.extra?.googlePlacesApiKey as string) ?? ''

  const query = useMemo(
    () => ({
      key: apiKey,
      language: 'en' as const,
      components: 'country:gb',
      location: `${mapLat},${mapLng}`,
      radius: 50000,
    }),
    [mapLat, mapLng, apiKey],
  )

  useEffect(() => {
    ref.current?.setAddressText(value ?? '')
    setHasInputText(Boolean(value?.trim()))
  }, [value])

  const emitText = (t: string) => {
    setHasInputText(Boolean(t.trim()))
    onChangeText?.(t)
    onSearchTextChange?.(t)
  }

  const autocomplete = (
    <GooglePlacesAutocomplete
      ref={ref}
      placeholder={placeholder}
      minLength={2}
      debounce={300}
      enablePoweredByContainer={false}
      fetchDetails
      keepResultsAfterBlur
      keyboardShouldPersistTaps="handled"
      listViewDisplayed="auto"
      GooglePlacesDetailsQuery={{ fields: 'geometry,formatted_address' }}
      query={query}
      disableScroll={false}
      renderLeftButton={
        isMapBar
          ? () => <Ionicons name="search-outline" size={18} color={MUTED} style={styles.searchIcon} />
          : () => null
      }
      textInputProps={{
        editable: enabled,
        placeholderTextColor: MUTED,
        autoCorrect: false,
        clearButtonMode: 'never',
        color: '#fff',
        selectionColor: '#fff',
        underlineColorAndroid: 'transparent',
        onChangeText: (t: string) => emitText(t),
        style: isMapBar ? undefined : formInputStyle,
      }}
      onPress={(data, details) => {
        if (!details?.geometry?.location) return
        const loc = details.geometry.location
        const lat = loc.lat ?? loc.latitude
        const lng = loc.lng ?? loc.longitude
        if (typeof lat !== 'number' || typeof lng !== 'number') return
        onSelect({
          lat,
          lng,
          name: data.structured_formatting?.main_text ?? data.description,
          display_name: details.formatted_address ?? data.description,
        })
        ref.current?.setAddressText('')
        setHasInputText(false)
        emitText('')
      }}
      styles={{
        container: isMapBar
          ? { flex: 1, minWidth: 0, zIndex: 200, elevation: 30 }
          : { alignSelf: 'stretch', width: '100%', zIndex: 200, elevation: 30 },
        textInputContainer: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          borderBottomWidth: 0,
          paddingHorizontal: 0,
          alignItems: 'center',
        },
        textInput: {
          backgroundColor: isMapBar ? 'transparent' : surfaceColor,
          color: '#fff',
          fontSize: isMapBar ? 15 : 16,
          height: 40,
          borderRadius: isMapBar ? 0 : 12,
          borderWidth: isMapBar ? 0 : 1,
          borderColor: 'rgba(255,255,255,0.2)',
          paddingHorizontal: isMapBar ? 4 : 12,
          marginTop: 0,
          marginBottom: 0,
          flex: 1,
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
        description: { color: '#fff', fontSize: 13 },
        separator: {
          backgroundColor: 'rgba(255,255,255,0.1)',
          height: StyleSheet.hairlineWidth,
        },
        loader: {
          flexDirection: 'row',
          justifyContent: 'flex-end',
          height: 20,
        },
        poweredContainer: { height: 0, overflow: 'hidden', opacity: 0 },
      }}
    />
  )

  if (!isMapBar) {
    return (
      <View style={styles.formWrap} collapsable={false} pointerEvents="auto">
        {autocomplete}
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
        {autocomplete}
      </View>
      {showMapClearButton && hasInputText ? (
        <Pressable
          onPress={() => {
            ref.current?.setAddressText('')
            emitText('')
          }}
          hitSlop={10}
          style={styles.clearBtn}
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={20} color={MUTED} />
        </Pressable>
      ) : null}
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
  clearBtn: {
    padding: 2,
    marginLeft: 4,
    flexShrink: 0,
  },
})
