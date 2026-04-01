import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { upsertProfile } from '../lib/profile-queries'
import { supabase } from '../lib/supabase'

type SignUpPayload = {
  firstName: string
  lastName: string
  email: string
  password: string
  phone?: string
  dateOfBirth?: string | null
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (payload: SignUpPayload) => Promise<{ error: string | null; info?: string }>
  resendConfirmation: (email: string) => Promise<{ error: string | null; info?: string }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (mounted) setSession(s)
      })
      .catch(() => {
        if (mounted) setSession(null)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      return { error: error.message?.trim() || 'Sign in failed' }
    }
    // TODO: Re-enable email confirmation before launch - requires SMTP setup
    // if (!data.session && data.user) {
    //   return {
    //     error: 'Confirm your email before signing in.',
    //   }
    // }
    // if (data.user && !data.user.email_confirmed_at) {
    //   await supabase.auth.signOut()
    //   return {
    //     error: 'Confirm your email before signing in. If no email arrives, ask support to enable email confirmations in Supabase Auth.',
    //   }
    // }
    return { error: null }
  }, [])

  const signUp = useCallback(async (payload: SignUpPayload) => {
    const email = payload.email.trim()
    const firstName = payload.firstName.trim()
    const lastName = payload.lastName.trim()
    const phone = payload.phone?.trim() || null
    const dateOfBirth = payload.dateOfBirth?.trim() || null

    const { data, error } = await supabase.auth.signUp({
      email,
      password: payload.password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    })
    if (error) {
      return { error: error.message }
    }
    if (data.user?.id) {
      await upsertProfile({
        id: data.user.id,
        first_name: firstName,
        last_name: lastName,
        phone,
        date_of_birth: dateOfBirth,
      })
    }
    // TODO: Re-enable email confirmation before launch - requires SMTP setup
    // const emailConfirmed = Boolean(data.user?.email_confirmed_at)
    // await supabase.auth.signOut()
    // if (!emailConfirmed) {
    //   return {
    //     error: null,
    //     info: `Check your email (${email}) to confirm your account, then sign in.`,
    //   }
    // }
    // return {
    //   error: null,
    //   info:
    //     'Account created, but verification email is not enabled in Supabase Auth for this project. You were signed out for safety; sign in manually.',
    // }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const resendConfirmation = useCallback(async (email: string) => {
    const normalized = email.trim()
    if (!normalized) return { error: 'Enter your email first.' }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalized,
    })
    if (error) {
      const msg = error.message?.trim() || 'Could not resend confirmation email.'
      if (msg.toLowerCase().includes('email') && msg.toLowerCase().includes('disabled')) {
        return {
          error: 'Verification emails are disabled in Supabase Auth for this project. Enable Email provider + confirmations to send them.',
        }
      }
      return { error: msg }
    }
    return { error: null, info: `Confirmation email sent to ${normalized}.` }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn,
      signUp,
      resendConfirmation,
      signOut,
    }),
    [session, loading, signIn, signUp, resendConfirmation, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
