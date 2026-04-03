import { useFocusEffect } from 'expo-router'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as Location from 'expo-location'
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { AppLogo } from '../../components/AppLogo'
import { AppTiledBackground } from '../../components/AppTiledBackground'
import { SettingsHomeEditModal } from '../../components/SettingsHomeEditModal'
import { useAuth } from '../../context/AuthContext'
import { deleteAllUserApplicationData } from '../../lib/account-deletion'
import { effectiveUserId } from '../../lib/dev-user'
import { deleteUserHome, fetchUserHome, upsertUserHome, type UserHomeRow } from '../../lib/home-queries'
import { fetchUserNudges } from '../../lib/nudge-queries'
import { fetchProfileByUserId, upsertProfile } from '../../lib/profile-queries'
import { getProfileDisplayName, profileInitial } from '../../lib/profile'
import { supabase } from '../../lib/supabase'
import {
  loadDefaultRadiusMeters,
  loadMapStylePreference,
  loadNotificationPreferences,
  saveDefaultRadiusMeters,
  saveMapStylePreference,
  saveNotifyArrive,
  saveNotifyBoth,
  saveNotifyLeave,
} from '../../lib/user-preferences'

const BG = '#0a0a0a'
const SURFACE = '#141414'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

type ProfileDraft = {
  firstName: string
  lastName: string
  email: string
  phone: string
  dateOfBirth: string
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth()
  const [nudgesCount, setNudgesCount] = useState(0)
  const [homeRow, setHomeRow] = useState<UserHomeRow | null>(null)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [editHomeOpen, setEditHomeOpen] = useState(false)
  const [savingHome, setSavingHome] = useState(false)
  const [notifyArrive, setNotifyArrive] = useState(true)
  const [notifyLeave, setNotifyLeave] = useState(true)
  const [notifyBoth, setNotifyBoth] = useState(true)
  const [defaultRadius, setDefaultRadius] = useState(25)
  const [satellite, setSatellite] = useState(false)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [showDobPicker, setShowDobPicker] = useState(false)

  const refresh = useCallback(async () => {
    const uid = effectiveUserId(user?.id)
    const [nRes, homeRes, notifPref, mapStyle, radius] = await Promise.all([
      fetchUserNudges(uid),
      fetchUserHome(uid),
      loadNotificationPreferences(),
      loadMapStylePreference(),
      loadDefaultRadiusMeters(),
    ])
    if (!nRes.error) setNudgesCount(nRes.data.length)
    if (!homeRes.error) setHomeRow(homeRes.data)
    const profileRes = await fetchProfileByUserId(uid)
    setProfileDraft({
      firstName: profileRes.data?.first_name?.trim() || '',
      lastName: profileRes.data?.last_name?.trim() || '',
      email: user?.email?.trim() || '',
      phone: profileRes.data?.phone?.trim() || '',
      dateOfBirth: profileRes.data?.date_of_birth?.trim() || '',
    })
    setNotifyArrive(notifPref.notifyArrive)
    setNotifyLeave(notifPref.notifyLeave)
    setNotifyBoth(notifPref.notifyBoth)
    setSatellite(mapStyle === 'satellite')
    setDefaultRadius(radius)
    if (Location && typeof Location.getCurrentPositionAsync === 'function') {
      void Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
        .then((pos) => {
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        })
        .catch(() => {
          setUserCoords(null)
        })
    } else {
      setUserCoords(null)
    }
  }, [user?.id, user?.email])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const displayName = useMemo(() => getProfileDisplayName(user ?? null), [user])
  const initial = useMemo(() => profileInitial(displayName, user?.email), [displayName, user?.email])
  const profileDirty = useMemo(() => {
    const emailChanged = profileDraft.email.trim() !== (user?.email?.trim() || '')
    return (
      emailChanged ||
      profileDraft.firstName.trim().length > 0 ||
      profileDraft.lastName.trim().length > 0 ||
      profileDraft.phone.trim().length > 0 ||
      profileDraft.dateOfBirth.trim().length > 0
    )
  }, [profileDraft, user?.email])

  const saveProfile = useCallback(async () => {
    if (savingProfile) return
    const uid = effectiveUserId(user?.id)
    setSavingProfile(true)
    try {
      const nextEmail = profileDraft.email.trim()
      if (nextEmail && nextEmail !== (user?.email?.trim() || '')) {
        const { error: updateEmailError } = await supabase.auth.updateUser({ email: nextEmail })
        if (updateEmailError) {
          Alert.alert('Could not update email', updateEmailError.message)
          setSavingProfile(false)
          return
        }
      }

      const profileRes = await upsertProfile({
        id: uid,
        first_name: profileDraft.firstName.trim() || null,
        last_name: profileDraft.lastName.trim() || null,
        phone: profileDraft.phone.trim() || null,
        date_of_birth: profileDraft.dateOfBirth.trim() || null,
      })
      if (profileRes.error) {
        Alert.alert('Could not save profile', profileRes.error)
        setSavingProfile(false)
        return
      }
      await refresh()
    } finally {
      setSavingProfile(false)
    }
  }, [user?.email, profileDraft, refresh, savingProfile])

  return (
    <AppTiledBackground>
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
        <View style={styles.screenHeader}>
          <AppLogo size={60} />
          <Text style={styles.screenTitle}>Settings</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{user?.email ?? 'No email'}</Text>

          <Text style={styles.profileLabel}>First name</Text>
          <TextInput
            style={styles.profileInput}
            value={profileDraft.firstName}
            onChangeText={(v) => setProfileDraft((p) => ({ ...p, firstName: v }))}
            placeholder="First name"
            placeholderTextColor={MUTED}
          />

          <Text style={styles.profileLabel}>Last name</Text>
          <TextInput
            style={styles.profileInput}
            value={profileDraft.lastName}
            onChangeText={(v) => setProfileDraft((p) => ({ ...p, lastName: v }))}
            placeholder="Last name"
            placeholderTextColor={MUTED}
          />

          <Text style={styles.profileLabel}>Email</Text>
          <TextInput
            style={styles.profileInput}
            value={profileDraft.email}
            onChangeText={(v) => setProfileDraft((p) => ({ ...p, email: v }))}
            placeholder="Email"
            placeholderTextColor={MUTED}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.profileLabel}>Phone</Text>
          <TextInput
            style={styles.profileInput}
            value={profileDraft.phone}
            onChangeText={(v) => setProfileDraft((p) => ({ ...p, phone: v }))}
            placeholder="Phone"
            placeholderTextColor={MUTED}
            keyboardType="phone-pad"
          />

          <Text style={styles.profileLabel}>Date of birth</Text>
          <Pressable style={styles.profileInput} onPress={() => setShowDobPicker(true)}>
            <Text style={[styles.profileDobText, !profileDraft.dateOfBirth && styles.profileDobPlaceholder]}>
              {profileDraft.dateOfBirth || 'Select date'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.profileSaveBtn, (!profileDirty || savingProfile) && styles.profileSaveBtnDisabled]}
            onPress={() => void saveProfile()}
            disabled={!profileDirty || savingProfile}
          >
            {savingProfile ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.profileSaveText}>Save profile</Text>}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Home</Text>
          <Text style={styles.rowSub}>{homeRow ? homeRow.name : 'No home set'}</Text>
          <Pressable style={styles.btnOutline} onPress={() => setEditHomeOpen(true)}>
            <Text style={styles.btnOutlineText}>{homeRow ? 'Edit home' : 'Set home'}</Text>
          </Pressable>
          {homeRow ? (
            <Pressable
              style={[styles.btnOutline, styles.btnDanger]}
              onPress={async () => {
                if (!homeRow?.id) return
                const uid = effectiveUserId(user?.id)
                const res = await deleteUserHome(uid, homeRow.id)
                if (!res.error) await refresh()
              }}
            >
              <Text style={styles.btnDangerText}>Clear home</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Notifications</Text>
          <RowSwitch
            label="Arrive nudges"
            value={notifyArrive}
            onChange={(v) => {
              setNotifyArrive(v)
              void saveNotifyArrive(v)
            }}
          />
          <RowSwitch
            label="Leave nudges"
            value={notifyLeave}
            onChange={(v) => {
              setNotifyLeave(v)
              void saveNotifyLeave(v)
            }}
          />
          <RowSwitch
            label="Both-trigger nudges"
            value={notifyBoth}
            onChange={(v) => {
              setNotifyBoth(v)
              void saveNotifyBoth(v)
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Map + Defaults</Text>
          <RowSwitch
            label="Satellite map"
            value={satellite}
            onChange={(v) => {
              setSatellite(v)
              void saveMapStylePreference(v ? 'satellite' : 'standard')
            }}
          />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Default radius</Text>
            <Pressable
              onPress={async () => {
                const next = defaultRadius >= 100 ? 10 : defaultRadius + 5
                setDefaultRadius(next)
                await saveDefaultRadiusMeters(next)
              }}
            >
              <Text style={styles.radiusBtn}>{defaultRadius} m</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Stats</Text>
          <Text style={styles.rowSub}>{nudgesCount} total nudges</Text>
        </View>

        <Pressable style={styles.signOut} onPress={() => void signOut()}>
          <Ionicons name="log-out-outline" color="#0a0a0a" size={18} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        <Pressable
          style={[styles.signOut, styles.deleteAll]}
          onPress={() => {
            const uid = effectiveUserId(user?.id)
            Alert.alert('Delete all app data?', 'This deletes your nudges and locations.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  const res = await deleteAllUserApplicationData(uid)
                  if (!res.error) await refresh()
                },
              },
            ])
          }}
        >
          <Ionicons name="trash-outline" color="#f87171" size={18} />
          <Text style={styles.deleteAllText}>Delete app data</Text>
          </Pressable>
        </ScrollView>
        </KeyboardAvoidingView>

        <SettingsHomeEditModal
          visible={editHomeOpen}
          homeRow={homeRow}
          userCoords={userCoords}
          onDismiss={() => setEditHomeOpen(false)}
          onSave={async (draft) => {
            const uid = effectiveUserId(user?.id)
            setSavingHome(true)
            const res = await upsertUserHome(uid, {
              name: draft.name,
              lat: draft.lat,
              lng: draft.lng,
              radiusMeters: homeRow?.radius_meters ?? 75,
            })
            setSavingHome(false)
            if (!res.error) {
              setEditHomeOpen(false)
              await refresh()
            }
          }}
          saving={savingHome}
        />
      </SafeAreaView>
      {showDobPicker ? (
        <DateTimePicker
          value={profileDraft.dateOfBirth ? new Date(profileDraft.dateOfBirth) : new Date(1990, 0, 1)}
          mode="date"
          maximumDate={new Date()}
          onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
            setShowDobPicker(false)
            if (event.type === 'dismissed' || !selectedDate) return
            const yyyy = selectedDate.getFullYear()
            const mm = String(selectedDate.getMonth() + 1).padStart(2, '0')
            const dd = String(selectedDate.getDate()).padStart(2, '0')
            setProfileDraft((p) => ({ ...p, dateOfBirth: `${yyyy}-${mm}-${dd}` }))
          }}
        />
      ) : null}
    </AppTiledBackground>
  )
}

function RowSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  keyboardAvoid: { flex: 1 },
  screenHeader: { alignItems: 'center', marginBottom: 4 },
  screenTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  content: { padding: 16, gap: 12, paddingBottom: 36 },
  card: { backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(0,191,165,0.35)', padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,191,165,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarText: { color: ACCENT, fontSize: 24, fontWeight: '700' },
  name: { color: '#fff', fontSize: 18, fontWeight: '700' },
  email: { color: MUTED, marginTop: 2 },
  profileLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  profileInput: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: '#fff',
  },
  profileDobText: { color: '#fff', fontSize: 14 },
  profileDobPlaceholder: { color: MUTED },
  profileSaveBtn: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  profileSaveBtnDisabled: { opacity: 0.45 },
  profileSaveText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  section: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  rowLabel: { color: '#fff', fontSize: 14 },
  rowSub: { color: MUTED, fontSize: 14, marginBottom: 8 },
  radiusBtn: { color: ACCENT, fontWeight: '700', fontSize: 14 },
  btnOutline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 10, alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  btnOutlineText: { color: '#fff', fontWeight: '600' },
  btnDanger: { borderColor: 'rgba(239,68,68,0.45)' },
  btnDangerText: { color: '#f87171', fontWeight: '600' },
  signOut: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  signOutText: { color: '#0a0a0a', fontWeight: '800', fontSize: 16 },
  deleteAll: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)' },
  deleteAllText: { color: '#f87171', fontWeight: '700', fontSize: 15 },
})
