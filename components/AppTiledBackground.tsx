import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import type { ReactNode } from 'react'

const TILE = require('../assets/images/background-tile.png')

type Props = {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}

/** Reusable app-wide textured background tile. */
export function AppTiledBackground({ children, style }: Props) {
  return (
    <View style={[styles.root, style]}>
      <Image source={TILE} resizeMode="repeat" style={styles.tile} />
      <View style={styles.content}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  tile: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.82,
  },
  content: {
    flex: 1,
  },
})
