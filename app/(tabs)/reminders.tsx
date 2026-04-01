import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppLogo } from '../../components/AppLogo'
import { AppTiledBackground } from '../../components/AppTiledBackground'
import NudgeList from '../../components/NudgeList'
import NudgeModal, { type NudgeSavePayload } from '../../components/NudgeModal'
import { useAuth } from '../../context/AuthContext'
import { effectiveUserId } from '../../lib/dev-user'
import { deleteNudgeForUser, fetchUserNudges, updateNudgeForUser } from '../../lib/nudge-queries'
import { loadDefaultRadiusMeters } from '../../lib/user-preferences'

const BG = '#0a0a0a'

export default function RemindersScreen() {
  const { user } = useAuth()
  const [nudges, setNudges] = useState<Awaited<ReturnType<typeof fetchUserNudges>>['data']>([])
  const [editNudge, setEditNudge] = useState<(typeof nudges)[number] | null>(null)
  const [radiusMeters, setRadiusMeters] = useState(25)
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = useCallback(async () => {
    const uid = effectiveUserId(user?.id)
    const [n, defaultRadius] = await Promise.all([fetchUserNudges(uid), loadDefaultRadiusMeters()])
    if (!n.error) setNudges(n.data)
    setRadiusMeters(defaultRadius)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const onDelete = useCallback(
    (id: string) => {
      const uid = effectiveUserId(user?.id)
      Alert.alert('Delete nudge?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteNudgeForUser(uid, id)
            if (!res.error) await refresh()
          },
        },
      ])
    },
    [refresh, user?.id],
  )

  const onSave = useCallback(
    async (payload: NudgeSavePayload) => {
      if (!payload.nudgeId || !payload.locationId) return
      const uid = effectiveUserId(user?.id)
      const res = await updateNudgeForUser(uid, payload.nudgeId, payload.locationId, payload)
      if (!res.error) {
        setModalOpen(false)
        await refresh()
        setTimeout(() => setEditNudge(null), 300)
      }
    },
    [refresh],
  )

  const listData = useMemo(() => nudges, [nudges])

  return (
    <AppTiledBackground>
      <SafeAreaView style={styles.root}>
        <View style={styles.screenHeader}>
          <AppLogo size={60} />
          <Text style={styles.screenTitle}>Nudges</Text>
        </View>
        <NudgeList
          nudges={listData}
          onEdit={(n) => {
            setEditNudge(n)
            setRadiusMeters(n.radius_meters)
            setModalOpen(true)
          }}
          onDelete={onDelete}
        />
        <NudgeModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false)
            setEditNudge(null)
          }}
          onSave={onSave}
          onDelete={onDelete}
          editNudge={editNudge}
          radiusMeters={radiusMeters}
          onRadiusMetersChange={setRadiusMeters}
        />
      </SafeAreaView>
    </AppTiledBackground>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  screenHeader: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  screenTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
})
