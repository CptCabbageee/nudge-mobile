import { Ionicons } from '@expo/vector-icons'
import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { NudgeListItem } from '../lib/nudge-queries'
import { distanceMetres } from '../lib/geo'
import { CategoryIcon } from './CategoryIcon'
import { TriggerGlyph } from './TriggerGlyph'

const BG = '#0a0a0a'
const SURFACE = '#141414'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'
const BORDER = 'rgba(0, 191, 165, 0.35)'

const NEAR_SEARCH_METRES = 120

function sortNudgesBySearchProximity(
  nudges: NudgeListItem[],
  anchor: { lat: number; lng: number } | null | undefined,
): NudgeListItem[] {
  if (!anchor) return nudges
  const near: { nudge: NudgeListItem; d: number }[] = []
  const far: NudgeListItem[] = []
  for (const n of nudges) {
    const d = distanceMetres({ lat: n.lat, lng: n.lng }, anchor)
    if (d <= NEAR_SEARCH_METRES) near.push({ nudge: n, d })
    else far.push(n)
  }
  near.sort((a, b) => a.d - b.d)
  return [...near.map((x) => x.nudge), ...far]
}

type NudgeListProps = {
  nudges: NudgeListItem[]
  onEdit: (nudge: NudgeListItem) => void
  onDelete: (id: string) => void
  searchAnchor?: { lat: number; lng: number } | null
}

export default function NudgeList({ nudges, onEdit, onDelete, searchAnchor = null }: NudgeListProps) {
  const ordered = useMemo(() => sortNudgesBySearchProximity(nudges, searchAnchor), [nudges, searchAnchor])

  if (nudges.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="location-outline" size={64} color={MUTED} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>No Nudges Yet</Text>
        <Text style={styles.emptySub}>
          Open the Map tab and tap the map to add your first location-based nudge
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      data={ordered}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      renderItem={({ item: nudge }) => {
        const nearSearch =
          !!searchAnchor && distanceMetres({ lat: nudge.lat, lng: nudge.lng }, searchAnchor) <= NEAR_SEARCH_METRES
        return (
          <View style={[styles.card, nearSearch && styles.cardNear]}>
            <View style={styles.cardTop}>
              <View style={styles.cardMain}>
                <View style={styles.titleRow}>
                  <CategoryIcon category={nudge.category} size={24} />
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {nudge.title}
                  </Text>
                  {nearSearch ? (
                    <View style={styles.nearBadge}>
                      <Ionicons name="location" size={12} color={ACCENT} />
                      <Text style={styles.nearBadgeText}>Near search</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.locLine} numberOfLines={2}>
                  {nudge.location_name}
                </Text>
                {nudge.notes ? (
                  <Text style={styles.notesLine} numberOfLines={3}>
                    {nudge.notes}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  <View style={styles.triggerBadge}>
                    <TriggerGlyph trigger={nudge.trigger} size={18} />
                  </View>
                  <Text style={styles.radiusBadge}>{nudge.radius_meters} m</Text>
                  <Text style={[styles.statusBadge, !nudge.is_active && styles.statusInactive]}>
                    {nudge.is_active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => onEdit(nudge)}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  accessibilityLabel="Edit nudge"
                >
                  <Ionicons name="pencil-outline" size={20} color={MUTED} />
                </Pressable>
                <Pressable
                  onPress={() => onDelete(nudge.id)}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  accessibilityLabel="Delete nudge"
                >
                  <Ionicons name="trash-outline" size={20} color="#f87171" />
                </Pressable>
              </View>
            </View>
          </View>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 32, gap: 12 },
  empty: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: { marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySub: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  cardNear: {
    borderLeftWidth: 4,
    borderLeftColor: ACCENT,
    backgroundColor: 'rgba(0, 191, 165, 0.08)',
  },
  cardTop: { flexDirection: 'row', gap: 12 },
  cardMain: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  cardTitle: { flex: 1, minWidth: 120, color: '#fff', fontSize: 16, fontWeight: '700' },
  nearBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 191, 165, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  nearBadgeText: { color: ACCENT, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  locLine: { color: MUTED, fontSize: 12, marginBottom: 6 },
  notesLine: { color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  triggerBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusBadge: {
    fontSize: 12,
    color: MUTED,
    backgroundColor: BG,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  statusBadge: {
    fontSize: 11,
    color: ACCENT,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  statusInactive: { color: MUTED },
  actions: { gap: 4 },
  iconBtn: { padding: 8 },
  pressed: { opacity: 0.7 },
})
