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
import type { SearchResult } from '../types'
import { AppLogo } from './AppLogo'
import { AppTiledBackground } from './AppTiledBackground'
import { GooglePlacesAddressSearchField } from './GooglePlacesAddressSearchField'

const BG = '#0a0a0a'
const SURFACE = '#141414'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

export type HomeDraft = { lat: number; lng: number; name: string }

export type HomeGateVariant = 'onboarding' | 'edit'

type Props = {
  visible: boolean
  variant?: HomeGateVariant
  mapPickActive: boolean
  draft: HomeDraft | null
  onDraftNameChange: (name: string) => void
  onDismissSecondary: () => void
  onStartMapPick: () => void
  onSave: () => void
  saving: boolean
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  onSelectSearchResult: (r: SearchResult) => void
  mapLat: number
  mapLng: number
}

export function HomeLocationGateModal({
  visible,
  variant = 'onboarding',
  mapPickActive,
  draft,
  onDraftNameChange,
  onDismissSecondary,
  onStartMapPick,
  onSave,
  saving,
  searchQuery,
  onSearchQueryChange,
  onSelectSearchResult,
  mapLat,
  mapLng,
}: Props) {
  const canSave = draft != null && draft.name.trim().length > 0
  const isEdit = variant === 'edit'
  const title = isEdit ? 'Edit home' : 'Set your home'
  const sub = isEdit
    ? 'Search for an address or tap the map to reposition your home pin.'
    : 'We use your home for context and nudges. Search for an address or drop a pin on the map.'
  const secondaryLabel = isEdit ? 'Cancel' : 'Not now'
  const saveLabel = isEdit ? 'Save changes' : 'Save home'

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismissSecondary}>
      <AppTiledBackground>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.overlay}>
            <View style={styles.card}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ flexGrow: 1 }}
              >
                <View style={styles.logoHeaderWrap}>
                  <AppLogo size={60} />
                </View>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.sub}>{sub}</Text>

                {mapPickActive ? (
                  <View style={styles.banner}>
                    <Text style={styles.bannerText}>Tap the map to place your home pin</Text>
                  </View>
                ) : null}

                <Text style={styles.label}>Search address</Text>
                <GooglePlacesAddressSearchField
                  variant="form"
                  value={searchQuery}
                  onChangeText={onSearchQueryChange}
                  enabled={visible && !mapPickActive}
                  placeholder="Street, postcode, place…"
                  accentColor={ACCENT}
                  surfaceColor={SURFACE}
                  mapLat={mapLat}
                  mapLng={mapLng}
                  onSelect={(r) => {
                    onSearchQueryChange('')
                    onSelectSearchResult(r)
                  }}
                  formInputStyle={styles.input}
                />

                <Pressable style={styles.mapPickBtn} onPress={onStartMapPick}>
                  <Text style={styles.mapPickBtnText}>Tap map to set location</Text>
                </Pressable>

                {draft ? (
                  <>
                    <Text style={styles.label}>Label</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Home"
                      placeholderTextColor={MUTED}
                      value={draft.name}
                      onChangeText={onDraftNameChange}
                    />
                  </>
                ) : null}

                <View style={styles.actions}>
                  <Pressable style={styles.skipBtn} onPress={onDismissSecondary} disabled={saving}>
                    <Text style={styles.skipText}>{secondaryLabel}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                    onPress={onSave}
                    disabled={!canSave || saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#0a0a0a" />
                    ) : (
                      <Text style={styles.saveText}>{saveLabel}</Text>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </AppTiledBackground>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: 'rgba(10,10,10,0.9)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.35)',
    padding: 18,
    maxHeight: '88%',
  },
  logoHeaderWrap: { alignItems: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  sub: { color: MUTED, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  banner: {
    backgroundColor: 'rgba(0,191,165,0.15)',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  bannerText: { color: ACCENT, fontSize: 14, fontWeight: '600', textAlign: 'center' },
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
  mapPickBtnText: { color: ACCENT, fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  skipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  skipText: { color: MUTED, fontSize: 16, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },
})
