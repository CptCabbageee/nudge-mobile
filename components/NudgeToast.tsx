import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'

type Props = {
  visible: boolean
  message: string
  onHide: () => void
}

export function NudgeToast({ visible, message, onHide }: Props) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => onHide())
    }
  }, [visible])

  if (!visible) return null

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View style={[styles.toast, { opacity }]}>
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 999,
    elevation: 20,
  },
  toast: {
    marginBottom: 160,
    backgroundColor: 'rgba(0,191,165,0.95)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  text: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '700',
  },
})
