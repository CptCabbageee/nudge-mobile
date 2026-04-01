import { useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { AppLogo } from './AppLogo'

const BG = '#141414'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

type Props = {
  visible: boolean
  onYes: () => void
  onNo: (dontAskAgain: boolean) => void
}

export function LeavingHomePromptModal({ visible, onYes, onNo }: Props) {
  const [dontAskAgain, setDontAskAgain] = useState(false)

  useEffect(() => {
    if (!visible) setDontAskAgain(false)
  }, [visible])

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => onNo(dontAskAgain)}>
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.logoHeaderWrap}>
              <AppLogo size={60} />
            </View>
          <Text style={styles.title}>Leaving home</Text>
          <Text style={styles.body}>Would you like a reminder when you leave home?</Text>

          <Pressable
            style={styles.checkRow}
            onPress={() => setDontAskAgain((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dontAskAgain }}
          >
            <View style={[styles.checkbox, dontAskAgain && styles.checkboxOn]}>
              {dontAskAgain ? <Ionicons name="checkmark" size={16} color="#0a0a0a" /> : null}
            </View>
            <Text style={styles.checkLabel}>{"Don't ask me again"}</Text>
          </Pressable>

            <View style={styles.actions}>
              <Pressable style={styles.btnGhost} onPress={() => onNo(dontAskAgain)}>
                <Text style={styles.btnGhostText}>No</Text>
              </Pressable>
              <Pressable style={styles.btnPrimary} onPress={onYes}>
                <Text style={styles.btnPrimaryText}>Yes</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.35)',
    padding: 20,
  },
  logoHeaderWrap: { alignItems: 'center', marginBottom: 10 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 10 },
  body: { color: MUTED, fontSize: 15, lineHeight: 22, marginBottom: 18 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 22,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxOn: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  checkLabel: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  actions: { flexDirection: 'row', gap: 12 },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  btnGhostText: { color: MUTED, fontSize: 16, fontWeight: '700' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },
})
