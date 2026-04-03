import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { LeavingHomePromptModal } from '../components/LeavingHomePromptModal'
import { fetchUserHome, type UserHomeRow } from '../lib/home-queries'
import { effectiveUserId } from '../lib/dev-user'
import { hasLeavingHomeNudge } from '../lib/nudge-queries'
import { markLeavingHomeNeverAskAgain, shouldSuppressLeavingHomePrompt } from '../lib/leaving-home-prompt'
import { useAuth } from './AuthContext'

export type LeavingHomeComposeHandler = (home: UserHomeRow) => void

type Ctx = {
  registerLeavingHomeComposeHandler: (handler: LeavingHomeComposeHandler | null) => void
  invalidateLeavingHomePromptCheck: () => void
}

const LeavingCtx = createContext<Ctx | null>(null)

export function useLeavingHomePrompt(): Ctx {
  const c = useContext(LeavingCtx)
  if (!c) {
    throw new Error('useLeavingHomePrompt must be used within LeavingHomePromptProvider')
  }
  return c
}

export function LeavingHomePromptProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [showPrompt, setShowPrompt] = useState(false)
  const [homeRow, setHomeRow] = useState<UserHomeRow | null>(null)
  const homeRowRef = useRef<UserHomeRow | null>(null)
  const composeHandlerRef = useRef<LeavingHomeComposeHandler | null>(null)
  const pendingHomeRef = useRef<UserHomeRow | null>(null)
  const checkedRef = useRef(false)
  const runningRef = useRef(false)

  const registerLeavingHomeComposeHandler = useCallback((handler: LeavingHomeComposeHandler | null) => {
    composeHandlerRef.current = handler
    if (handler && pendingHomeRef.current) {
      const p = pendingHomeRef.current
      pendingHomeRef.current = null
      handler(p)
    }
  }, [])

  const runCheck = useCallback(async () => {
    if (runningRef.current) return
    if (checkedRef.current) return
    runningRef.current = true
    try {
      const uid = effectiveUserId(user?.id)
      const { data: home } = await fetchUserHome(uid)
      homeRowRef.current = home
      setHomeRow(home)
      if (!home) {
        checkedRef.current = true
        return
      }
      if (await shouldSuppressLeavingHomePrompt()) {
        checkedRef.current = true
        return
      }
      if (await hasLeavingHomeNudge(uid, home.id)) {
        checkedRef.current = true
        return
      }
      checkedRef.current = true
      setShowPrompt(true)
    } catch {
      checkedRef.current = false
    } finally {
      runningRef.current = false
    }
  }, [user?.id])

  const invalidateLeavingHomePromptCheck = useCallback(() => {
    checkedRef.current = false
    void runCheck()
  }, [runCheck])

  useEffect(() => {
    if (!user) {
      setShowPrompt(false)
      homeRowRef.current = null
      setHomeRow(null)
      checkedRef.current = false
      pendingHomeRef.current = null
    }
  }, [user])

  useEffect(() => {
    let previous = AppState.currentState
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (previous.match(/inactive|background/) && next === 'active') {
        checkedRef.current = false
        void runCheck()
      }
      previous = next
    })
    return () => sub.remove()
  }, [runCheck])

  useEffect(() => {
    checkedRef.current = false
    void runCheck()
  }, [user?.id, runCheck])

  const onNo = useCallback((dontAskAgain: boolean) => {
    setShowPrompt(false)
    if (dontAskAgain) void markLeavingHomeNeverAskAgain()
  }, [])

  const onYes = useCallback(() => {
    setShowPrompt(false)
    const home = homeRowRef.current
    if (!home) return
    const h = composeHandlerRef.current
    if (h) {
      h(home)
    } else {
      pendingHomeRef.current = home
    }
  }, [])

  const value = useMemo(
    () => ({ registerLeavingHomeComposeHandler, invalidateLeavingHomePromptCheck }),
    [registerLeavingHomeComposeHandler, invalidateLeavingHomePromptCheck],
  )

  return (
    <LeavingCtx.Provider value={value}>
      {children}
      <LeavingHomePromptModal visible={showPrompt} onYes={onYes} onNo={onNo} />
    </LeavingCtx.Provider>
  )
}
