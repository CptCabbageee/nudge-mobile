import type { ReactNode } from 'react'
import { Ionicons } from '@expo/vector-icons'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppLogo } from './AppLogo'

const BG = '#141414'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

type Props = {
  visible: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function SettingsFormSheet({ visible, title, onClose, children }: Props) {
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
          <View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 20),
                maxHeight: '88%',
              },
            ]}
          >
            <View style={styles.handleRow}>
              <View style={styles.handle} />
              <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
                <Ionicons name="close" size={24} color={MUTED} />
              </Pressable>
            </View>
            <View style={styles.logoHeaderWrap}>
              <AppLogo size={60} />
            </View>
            <Text style={styles.title}>{title}</Text>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: 'rgba(20,20,20,0.94)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.3)',
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handleRow: { alignItems: 'center', marginBottom: 8, position: 'relative' },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  closeBtn: { position: 'absolute', right: 0, top: -4, padding: 4 },
  logoHeaderWrap: { alignItems: 'center', marginBottom: 8 },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
  },
})
