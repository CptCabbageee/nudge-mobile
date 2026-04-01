import Slider from '@react-native-community/slider'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { NudgeListItem } from '../lib/nudge-queries'
import { CATEGORIES } from '../lib/categories'
import { RADIUS_STEPS_METERS, snapMetersToStep, type RadiusMeters } from '../lib/nudge-radius'
import { CategoryIcon } from './CategoryIcon'
import { AppLogo } from './AppLogo'
import { TriggerGlyph, type NudgeTrigger } from './TriggerGlyph'

const BG = '#0a0a0a'
const SURFACE = '#141414'
const BORDER_MUTED = 'rgba(255,255,255,0.25)'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'
const FIELD_ERROR = '#ff6b6b'

export type NudgeSavePayload = {
  title: string
  notes: string
  location: string
  coordinates: { lat: number; lng: number }
  trigger: NudgeTrigger
  radius_meters: RadiusMeters
  category: string
  nudgeId?: string
  locationId?: string
  /** Create nudge on this existing location row (e.g. home) instead of inserting a new location. */
  reuseLocationId?: string
}

export type NudgeModalVisualPreset = 'default' | 'mapGeofencePreview'

export interface NudgeModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (nudge: NudgeSavePayload) => void
  onDelete?: (id: string) => void
  editNudge?: NudgeListItem | null
  initialCoordinates?: { lat: number; lng: number } | null
  initialTitle?: string
  initialCategory?: string
  radiusMeters: number
  onRadiusMetersChange: (meters: number) => void
  /** Lighter dim + shorter sheet so the map geofence preview stays visible underneath. */
  visualPreset?: NudgeModalVisualPreset
  /** Hide radius slider (e.g. radius chosen on map in step 1). */
  hideRadiusSection?: boolean
  initialNotes?: string
  initialTrigger?: NudgeTrigger
  /** Shown in the read-only location field for new nudges (e.g. home name). */
  initialLocationLabel?: string
  /** When set with initialCoordinates and no editNudge, save attaches to this location id. */
  reuseLocationId?: string | null
}

type FormCore = Omit<NudgeSavePayload, 'radius_meters' | 'nudgeId' | 'locationId'>

const emptyForm = (coords: { lat: number; lng: number }): FormCore => ({
  title: '',
  notes: '',
  location: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
  coordinates: coords,
  trigger: 'arrive',
  category: '⭐',
})

export default function NudgeModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  editNudge,
  initialCoordinates,
  initialTitle,
  initialCategory,
  radiusMeters,
  onRadiusMetersChange,
  visualPreset = 'default',
  hideRadiusSection = false,
  initialNotes,
  initialTrigger,
  initialLocationLabel,
  reuseLocationId = null,
}: NudgeModalProps) {
  const [formData, setFormData] = useState<FormCore | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)

  const onRadiusMetersChangeRef = useRef(onRadiusMetersChange)
  onRadiusMetersChangeRef.current = onRadiusMetersChange

  useEffect(() => {
    if (isOpen && editNudge) {
      onRadiusMetersChangeRef.current(snapMetersToStep(editNudge.radius_meters))
    }
  }, [isOpen, editNudge?.id, editNudge?.radius_meters])

  useLayoutEffect(() => {
    if (!isOpen) {
      setFormData(null)
      return
    }

    if (editNudge) {
      setTitleError(null)
      setFormData({
        title: editNudge.title,
        notes: editNudge.notes ?? '',
        location: editNudge.location_name,
        coordinates: { lat: editNudge.lat, lng: editNudge.lng },
        trigger: editNudge.trigger,
        category: editNudge.category || '⭐',
      })
      return
    }

    if (initialCoordinates && reuseLocationId) {
      setTitleError(null)
      const locLabel =
        initialLocationLabel?.trim() ||
        `${initialCoordinates.lat.toFixed(4)}, ${initialCoordinates.lng.toFixed(4)}`
      setFormData({
        ...emptyForm(initialCoordinates),
        title: initialTitle?.trim() ?? '',
        notes: initialNotes?.trim() ?? '',
        location: locLabel,
        trigger: initialTrigger ?? 'arrive',
        category: initialCategory || '⭐',
      })
      return
    }

    if (initialCoordinates) {
      setTitleError(null)
      setFormData({
        ...emptyForm(initialCoordinates),
        title: initialTitle?.trim() ?? '',
        location:
          initialTitle?.trim() ||
          `${initialCoordinates.lat.toFixed(4)}, ${initialCoordinates.lng.toFixed(4)}`,
        category: initialCategory || '⭐',
      })
    }
  }, [
    isOpen,
    editNudge?.id,
    editNudge?.title,
    editNudge?.notes,
    editNudge?.location_name,
    editNudge?.lat,
    editNudge?.lng,
    editNudge?.trigger,
    editNudge?.category,
    initialCoordinates?.lat,
    initialCoordinates?.lng,
    initialTitle,
    initialCategory,
    initialNotes,
    initialTrigger,
    initialLocationLabel,
    reuseLocationId,
  ])

  const defaultStep = 2
  const stepIndex =
    RADIUS_STEPS_METERS.indexOf(radiusMeters as (typeof RADIUS_STEPS_METERS)[number]) >= 0
      ? RADIUS_STEPS_METERS.indexOf(radiusMeters as (typeof RADIUS_STEPS_METERS)[number])
      : defaultStep

  const handleSave = () => {
    console.log('[NudgeModal handleSave] start', { hasFormData: Boolean(formData) })
    if (!formData) return
    if (!formData.title.trim()) {
      setTitleError('Please add a title')
      return
    }
    setTitleError(null)
    console.log('[NudgeModal save payload]', {
      title: formData.title,
      notes: formData.notes,
      notesLen: formData.notes?.length,
    })
    onSave({
      ...formData,
      coordinates: formData.coordinates,
      radius_meters: snapMetersToStep(radiusMeters),
      nudgeId: editNudge?.id,
      locationId: editNudge?.location_id,
      reuseLocationId: reuseLocationId ?? undefined,
    })
  }

  const handleDelete = () => {
    if (!editNudge || !onDelete) return
    onDelete(editNudge.id)
  }

  const setCategory = (v: string) => {
    if (v) setFormData((prev) => (prev ? { ...prev, category: v } : prev))
  }

  const isEdit = Boolean(editNudge)
  const mapPreview = visualPreset === 'mapGeofencePreview'

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <Pressable
            style={[styles.backdropDim, mapPreview && styles.backdropDimMapPreview]}
            onPress={onClose}
          />
          <View style={[styles.sheet, mapPreview && styles.sheetMapPreview]}>
          <View style={styles.sheetHeader}>
            <View style={styles.handle} />
            <View style={styles.logoHeaderWrap}>
              <AppLogo size={60} />
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={MUTED} />
            </Pressable>
          </View>
          {!formData ? (
            <View style={styles.loadingInner}>
              <ActivityIndicator size="large" color={ACCENT} />
            </View>
          ) : (
            <>
          <View style={styles.headerTextBlock}>
            <Text style={styles.heading}>{isEdit ? 'Edit Nudge' : 'Create Nudge'}</Text>
            <Text style={styles.subtitle}>
              {isEdit ? 'Edit your nudge settings' : 'Create a new location-based nudge'}
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={true}
            automaticallyAdjustKeyboardInsets={true}
          >
            <Text style={styles.label}>Title</Text>
            <TextInput
              placeholder="What do you need to remember?"
              placeholderTextColor={MUTED}
              value={formData.title}
              onChangeText={(t) => {
                setTitleError(null)
                setFormData((prev) => (prev ? { ...prev, title: t } : prev))
              }}
              style={[styles.input, titleError && styles.inputError]}
            />
            {titleError ? <Text style={styles.fieldError}>{titleError}</Text> : null}

            <Text style={styles.label}>Notes</Text>
            <TextInput
              placeholder="Checklist or notes (one item per line)…"
              placeholderTextColor={MUTED}
              value={formData.notes}
              onChangeText={(t) => setFormData((prev) => (prev ? { ...prev, notes: t } : prev))}
              style={[styles.input, styles.textarea]}
              multiline
              textAlignVertical="top"
            />

            <Text style={styles.label}>Location</Text>
            <TextInput
              placeholder="Location"
              placeholderTextColor={MUTED}
              value={formData.location}
              editable={false}
              style={[styles.input, styles.inputReadonly]}
            />

            <Text style={styles.label}>Trigger</Text>
            <View style={styles.triggerRow}>
              {(
                [
                  { value: 'arrive' as const, label: 'Arrive' },
                  { value: 'leave' as const, label: 'Leave' },
                  { value: 'both' as const, label: 'Both' },
                ] as const
              ).map(({ value, label }) => {
                const selected = formData.trigger === value
                return (
                  <Pressable
                    key={value}
                    onPress={() => setFormData((prev) => (prev ? { ...prev, trigger: value } : prev))}
                    style={[styles.triggerIconBtn, selected && styles.triggerIconBtnSelected]}
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                  >
                    <TriggerGlyph trigger={value} size={24} />
                  </Pressable>
                )
              })}
            </View>

            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((cat) => {
                const selected = formData.category === cat
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={[styles.categoryCell, selected && styles.categoryCellSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Category ${cat}`}
                  >
                    <CategoryIcon category={cat} size={28} />
                  </Pressable>
                )
              })}
            </View>

            {!hideRadiusSection ? (
              <>
                <Text style={styles.label}>Radius</Text>
                {mapPreview && !isEdit ? (
                  <Text style={styles.radiusHint}>
                    {RADIUS_STEPS_METERS.join(', ')} meters — drag to resize the circle on the map
                  </Text>
                ) : null}
                <View style={styles.sliderBlock}>
                  <View style={styles.sliderRow}>
                    <Slider
                      style={styles.sliderFlex}
                      minimumValue={0}
                      maximumValue={RADIUS_STEPS_METERS.length - 1}
                      step={1}
                      value={stepIndex}
                      minimumTrackTintColor={ACCENT}
                      maximumTrackTintColor={BORDER_MUTED}
                      thumbTintColor={ACCENT}
                      accessibilityLabel="Geofence radius"
                      onValueChange={(v) => {
                        const i = Math.round(v)
                        const m = RADIUS_STEPS_METERS[Math.max(0, Math.min(i, RADIUS_STEPS_METERS.length - 1))]
                        onRadiusMetersChangeRef.current(m)
                      }}
                    />
                    <Text style={styles.sliderValueNext}>{radiusMeters} m</Text>
                  </View>
                  <View style={styles.sliderTicks}>
                    {RADIUS_STEPS_METERS.map((m) => (
                      <Text key={m} style={[styles.tickLabel, m === radiusMeters && styles.tickActive]}>
                        {m}m
                      </Text>
                    ))}
                  </View>
                </View>
              </>
            ) : null}
            <View style={styles.footer}>
              <Pressable onPress={handleSave} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>{isEdit ? 'Save Changes' : 'Save'}</Text>
              </Pressable>
              <Pressable onPress={onClose} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              {isEdit && onDelete ? (
                <Pressable onPress={handleDelete} style={styles.btnDanger}>
                  <Text style={styles.btnDangerText}>Delete</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
            </>
          )}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropDim: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  backdropDimMapPreview: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  sheet: {
    zIndex: 2,
    elevation: 24,
    backgroundColor: 'rgba(10,10,10,0.92)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: BORDER_MUTED,
    maxHeight: '95%',
    minHeight: '80%',
    paddingBottom: Platform.select({ ios: 28, default: 8 }),
  },
  sheetMapPreview: {
    maxHeight: '75%',
    minHeight: '65%',
  },
  sheetHeader: {
    position: 'relative',
    paddingTop: 10,
    paddingHorizontal: 8,
    paddingBottom: 4,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  closeBtn: { position: 'absolute', right: 8, top: 4, padding: 4, zIndex: 3 },
  logoHeaderWrap: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 2,
    backgroundColor: 'transparent',
  },
  loadingInner: {
    flex: 1,
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  headerTextBlock: { paddingHorizontal: 20, paddingBottom: 8 },
  heading: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: MUTED, fontSize: 14, marginTop: 4 },
  scroll: { flexGrow: 1, flexShrink: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  label: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  radiusHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginBottom: 6,
    marginTop: -2,
  },
  input: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER_MUTED,
    borderRadius: 12,
    color: '#fff',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  inputError: {
    borderColor: FIELD_ERROR,
  },
  fieldError: {
    color: FIELD_ERROR,
    fontSize: 13,
    marginTop: 6,
    fontWeight: '600',
  },
  inputReadonly: { opacity: 0.85 },
  textarea: { minHeight: 120, paddingTop: 12 },
  sliderBlock: { marginTop: 4, marginBottom: 8 },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  sliderFlex: { flex: 1, height: 44 },
  sliderValueNext: {
    minWidth: 44,
    color: ACCENT,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  sliderTicks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  tickLabel: { color: MUTED, fontSize: 10, fontWeight: '600' },
  tickActive: { color: ACCENT },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  categoryCell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER_MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCellSelected: {
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: 'rgba(0, 191, 165, 0.12)',
  },
  triggerRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 8 },
  triggerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: BORDER_MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerIconBtnSelected: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(0, 191, 165, 0.2)',
  },
  footer: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  btnPrimary: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimaryText: { color: BG, fontSize: 16, fontWeight: '700' },
  btnGhost: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER_MUTED,
  },
  btnGhostText: { color: MUTED, fontSize: 16, fontWeight: '600' },
  btnDanger: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.5)',
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  btnDangerText: { color: '#f87171', fontSize: 16, fontWeight: '700' },
})
