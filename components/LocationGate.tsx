import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { AppLogo } from './AppLogo'
import { AppTiledBackground } from './AppTiledBackground'

const BG = '#0a0a0a'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

type LocationGateProps = {
  geoLoading: boolean
  geoDenied: boolean
  onTryAgain: () => void
}

export function LocationGate({ geoLoading, geoDenied, onTryAgain }: LocationGateProps) {
  if (geoLoading) {
    return (
      <AppTiledBackground>
        <View style={styles.centered}>
          <AppLogo />
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Getting your location…</Text>
        </View>
      </AppTiledBackground>
    )
  }

  return (
    <AppTiledBackground>
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.brand}>Nudge</Text>
          <Ionicons name="location-outline" size={72} color={ACCENT} style={styles.icon} />
          <Text style={styles.title}>Location Required</Text>
          <Text style={styles.body}>
            Nudge can&apos;t work without your location. It&apos;s how we know when you arrive or leave somewhere to
            trigger your nudges.
          </Text>
          {geoDenied ? (
            <Text style={styles.hint}>
              To re-enable location, open Settings → Apps → Nudge → Permissions → Location → Allow, then tap Try Again.
            </Text>
          ) : null}
          <Pressable onPress={onTryAgain} style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}>
            <Text style={styles.btnText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    </AppTiledBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: 'transparent',
  },
  loadingText: { color: MUTED, fontSize: 15 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 165, 0.35)',
    backgroundColor: 'rgba(20,20,20,0.9)',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  brand: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    color: ACCENT,
    marginBottom: 8,
  },
  icon: { alignSelf: 'center', marginBottom: 12, opacity: 0.9 },
  title: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 12,
  },
  body: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
  },
  hint: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    fontSize: 14,
    lineHeight: 20,
    color: MUTED,
  },
  btn: {
    marginTop: 24,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.9 },
  btnText: { color: BG, fontSize: 17, fontWeight: '700' },
})
