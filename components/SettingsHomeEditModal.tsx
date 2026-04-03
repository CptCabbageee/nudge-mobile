import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import MapView, { Marker, UrlTile, type MapPressEvent, type Region } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { UserHomeRow } from '../lib/home-queries'
import type { SearchResult } from '../types'
import type { HomeDraft } from './HomeLocationGateModal'
import { AppLogo } from './AppLogo'
import { GooglePlacesAddressSearchField } from './GooglePlacesAddressSearchField'

const BG = '#141414'
const SURFACE = '#1a1a1a'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

const TILE_OSM_FR_HOT = 'https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png'
const SEARCH_FALLBACK_LAT = 51.5
const SEARCH_FALLBACK_LNG = -0.127

type Props = {
  visible: boolean
  homeRow: UserHomeRow | null
  userCoords: { lat: number; lng: number } | null
  onDismiss: () => void
  onSave: (draft: HomeDraft) => void
  saving: boolean
}

export function SettingsHomeEditModal({
  visible,
  homeRow,
  userCoords,
  onDismiss,
  onSave,
  saving,
}: Props) {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState<HomeDraft | null>(null)
  const [mapPick, setMapPick] = useState(false)
  const mapRef = useRef<MapView | null>(null)

  useEffect(() => {
    if (!visible || !homeRow) return
    setDraft({ lat: homeRow.lat, lng: homeRow.lng, name: homeRow.name })
    setMapPick(false)
  }, [visible, homeRow?.id, homeRow?.lat, homeRow?.lng, homeRow?.name])

  const onSelectSearch = useCallback((r: SearchResult) => {
    const name = (r.display_name || r.name).trim() || 'Home'
    setDraft({ lat: r.lat, lng: r.lng, name })
    const region: Region = {
      latitude: r.lat,
      longitude: r.lng,
      latitudeDelta: 0.012,
      longitudeDelta: 0.012,
    }
    mapRef.current?.animateToRegion(region, 400)
  }, [])

  const onMapPress = useCallback(
    (e: MapPressEvent) => {
      if (!mapPick) return
      const c = e.nativeEvent.coordinate
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return
      setDraft((prev) =>
        prev
          ? {
              lat: c.latitude,
              lng: c.longitude,
              name: prev.name?.trim() ? prev.name : 'Home',
            }
          : { lat: c.latitude, lng: c.longitude, name: 'Home' },
      )
      setMapPick(false)
    },
    [mapPick],
  )

  const canSave = draft != null && draft.name.trim().length > 0
  const initialRegion: Region | undefined =
    draft != null
      ? {
          latitude: draft.lat,
          longitude: draft.lng,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }
      : homeRow != null
        ? {
            latitude: homeRow.lat,
            longitude: homeRow.lng,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          }
        : userCoords != null
          ? {
              latitude: userCoords.lat,
              longitude: userCoords.lng,
              latitudeDelta: 0.014,
              longitudeDelta: 0.014,
            }
          : {
              latitude: 51.505,
              longitude: -0.09,
              latitudeDelta: 0.08,
              longitudeDelta: 0.08,
            }

  const showMap = Platform.OS !== 'web'

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={onDismiss} disabled={saving} />
          <View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                maxHeight: '92%',
              },
            ]}
          >
            <View style={styles.handleRow}>
              <View style={styles.handle} />
              <Pressable onPress={onDismiss} disabled={saving} style={styles.closeBtn} hitSlop={12}>
                <Ionicons name="close" size={24} color={MUTED} />
              </Pressable>
            </View>
            <View style={styles.logoHeaderWrap}>
              <AppLogo size={60} />
            </View>
            <Text style={styles.screenTitle}>Edit home</Text>
            <Text style={styles.sub}>
              Search for an address or use the map to reposition. This stays on the Settings screen.
            </Text>

          <Text style={styles.label}>Search</Text>
          <GooglePlacesAddressSearchField
            variant="form"
            enabled={visible}
            placeholder="Street, postcode, place…"
            accentColor={ACCENT}
            surfaceColor={SURFACE}
            mapLat={userCoords?.lat ?? SEARCH_FALLBACK_LAT}
            mapLng={userCoords?.lng ?? SEARCH_FALLBACK_LNG}
            onSelect={onSelectSearch}
            formInputStyle={styles.input}
          />

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {showMap ? (
              <>
                <Pressable
                  style={[styles.mapPickBtn, mapPick && styles.mapPickBtnActive]}
                  onPress={() => setMapPick((m) => !m)}
                >
                  <Text style={styles.mapPickBtnText}>
                    {mapPick ? 'Tap the map to place the pin' : 'Tap map to reposition home'}
                  </Text>
                </Pressable>
                <View style={styles.mapWrap}>
                  <MapView
                    ref={mapRef}
                    style={styles.map}
                    initialRegion={initialRegion}
                    mapType={Platform.OS === 'android' ? 'none' : 'standard'}
                    userInterfaceStyle="dark"
                    onPress={onMapPress}
                  >
                    <UrlTile urlTemplate={TILE_OSM_FR_HOT} maximumZ={19} flipY={false} />
                    {draft ? (
                      <Marker coordinate={{ latitude: draft.lat, longitude: draft.lng }} tracksViewChanges={false} />
                    ) : null}
                  </MapView>
                </View>
              </>
            ) : (
              <Text style={styles.webNote}>Map repositioning is available on iOS and Android.</Text>
            )}

            <Text style={styles.label}>Label</Text>
            <TextInput
              style={styles.input}
              placeholder="Home"
              placeholderTextColor={MUTED}
              value={draft?.name ?? ''}
              onChangeText={(name) => setDraft((d) => (d ? { ...d, name } : d))}
              editable={draft != null}
            />

            <Pressable
              style={[styles.saveBtn, (!canSave || saving) && styles.saveBtnDisabled]}
              onPress={() => draft && canSave && onSave(draft)}
              disabled={!canSave || saving}
            >
              {saving ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.saveBtnText}>Save home</Text>
              )}
            </Pressable>
          </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: 'rgba(20,20,20,0.94)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.3)',
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handleRow: { alignItems: 'center', marginBottom: 4, position: 'relative' },
  logoHeaderWrap: { alignItems: 'center', marginBottom: 8 },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  closeBtn: { position: 'absolute', right: 0, top: -4, padding: 4 },
  screenTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  sub: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  scrollContent: { paddingBottom: 12 },
  label: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  mapPickBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT,
    alignItems: 'center',
  },
  mapPickBtnActive: { backgroundColor: 'rgba(0,191,165,0.15)' },
  mapPickBtnText: { color: ACCENT, fontSize: 15, fontWeight: '700' },
  mapWrap: {
    marginTop: 10,
    height: 200,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.25)',
  },
  map: { flex: 1 },
  webNote: { color: MUTED, fontSize: 13, marginTop: 12, fontStyle: 'italic' },
  saveBtn: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },
})
