import { useEffect, useRef } from 'react'
import { Animated, Image, StyleSheet, Text, View } from 'react-native'

type Props = {
  visible: boolean
  message: string
  onHide: () => void
}

export function NudgeToast({ visible, message, onHide }: Props) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onHide())
  }, [visible])

  if (!visible) return null

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
        <View style={styles.logoWrap}>
          <Image source={require('../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 220,
    zIndex: 99999,
    elevation: 99999,
  },
  toast: {
    backgroundColor: 'rgba(0,191,165,0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  logo: {
    width: 20,
    height: 20,
  },
  text: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '700',
  },
})
