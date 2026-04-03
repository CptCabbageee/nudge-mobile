import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AppTiledBackground } from './AppTiledBackground'

type Props = { children: ReactNode }
type State = { error: Error | null; componentStack: string | null }

const BG = '#0a0a0a'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }
  private previousGlobalHandler: ((error: unknown, isFatal?: boolean) => void) | null = null

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidMount() {
    // Capture non-React fatal JS errors so we can render details instead of the generic red/blue crash screen.
    const maybeErrorUtils = (global as unknown as { ErrorUtils?: unknown }).ErrorUtils as
      | {
          getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void
          setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void
        }
      | undefined
    const get = maybeErrorUtils?.getGlobalHandler
    const set = maybeErrorUtils?.setGlobalHandler
    if (typeof get === 'function' && typeof set === 'function') {
      this.previousGlobalHandler = get()
      set((error: unknown, isFatal?: boolean) => {
        const e = error instanceof Error ? error : new Error(String(error))
        this.setState({
          error: e,
          componentStack: isFatal ? '[Global fatal JS error]' : '[Global JS error]',
        })
        console.error('[AppErrorBoundary][Global]', e.message, e.stack, { isFatal })
      })
    }
  }

  componentWillUnmount() {
    const maybeErrorUtils = (global as unknown as { ErrorUtils?: unknown }).ErrorUtils as
      | {
          setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void
        }
      | undefined
    if (this.previousGlobalHandler && typeof maybeErrorUtils?.setGlobalHandler === 'function') {
      maybeErrorUtils.setGlobalHandler(this.previousGlobalHandler)
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null })
    console.error('[AppErrorBoundary]', error.message, error.stack, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null, componentStack: null })
  }

  render() {
    if (this.state.error) {
      const err = this.state.error
      return (
        <AppTiledBackground>
          <View style={styles.root}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>{err.name}: {err.message}</Text>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollInner}
              keyboardShouldPersistTaps="handled"
            >
              {err.stack ? (
                <Text selectable style={styles.mono}>
                  {err.stack}
                </Text>
              ) : null}
              {this.state.componentStack ? (
                <Text selectable style={[styles.mono, styles.stackGap]}>
                  {this.state.componentStack}
                </Text>
              ) : null}
            </ScrollView>
            <Pressable onPress={this.reset} style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}>
              <Text style={styles.btnText}>Try again</Text>
            </Pressable>
          </View>
        </AppTiledBackground>
      )
    }
    return this.props.children
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  title: { color: ACCENT, fontSize: 20, fontWeight: '800', marginBottom: 12 },
  message: { color: '#fff', fontSize: 16, marginBottom: 16, lineHeight: 22 },
  scroll: { flex: 1, maxHeight: '70%' },
  scrollInner: { paddingBottom: 16 },
  mono: { color: MUTED, fontSize: 11 },
  stackGap: { marginTop: 16 },
  btn: {
    marginTop: 16,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.9 },
  btnText: { color: BG, fontSize: 16, fontWeight: '700' },
})
