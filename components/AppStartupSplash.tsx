import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { AppLogo } from './AppLogo'
import { AppTiledBackground } from './AppTiledBackground'

const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.75)'

type Props = {
  message?: string
}

/** Full-screen startup splash used while critical app boot data loads. */
export function AppStartupSplash({ message = 'Loading…' }: Props) {
  return (
    <AppTiledBackground>
      <View style={styles.center}>
        <AppLogo />
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.message}>{message}</Text>
      </View>
    </AppTiledBackground>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: 'transparent',
  },
  message: {
    color: MUTED,
    fontSize: 15,
  },
})
