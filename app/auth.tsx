import { Redirect } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Ionicons } from '@expo/vector-icons'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { AppLogo } from '../components/AppLogo'
import { AppTiledBackground } from '../components/AppTiledBackground'
import { useAuth } from '../context/AuthContext'

const BG = '#0a0a0a'
const ACCENT = '#00BFA5'
const MUTED = 'rgba(255,255,255,0.55)'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/

function formatDateForUi(value: string | null): string {
  if (!value) return 'Select date'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Select date'
  return d.toLocaleDateString()
}

function FieldErrorBubble({ message }: { message: string | null }) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(4)).current

  useEffect(() => {
    if (!message) return
    opacity.setValue(0)
    translateY.setValue(4)
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start()
  }, [message, opacity, translateY])

  if (!message) return null
  return (
    <Animated.View style={[styles.fieldErrorBubble, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.fieldErrorText}>{message}</Text>
    </Animated.View>
  )
}

export default function AuthScreen() {
  const { user, loading, signIn, signUp, resendConfirmation } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null)
  const [showDobPicker, setShowDobPicker] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [revealPasswordTemporarily, setRevealPasswordTemporarily] = useState(false)
  const [revealConfirmTemporarily, setRevealConfirmTemporarily] = useState(false)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [touched, setTouched] = useState({
    firstName: false,
    lastName: false,
    email: false,
    password: false,
    confirmPassword: false,
  })

  const isEmailValid = useMemo(() => EMAIL_RE.test(email.trim()), [email])
  const fieldErrors = useMemo(
    () => ({
      firstName: isSignUp && firstName.trim().length < 1 ? 'First name is required.' : null,
      lastName: isSignUp && lastName.trim().length < 1 ? 'Last name is required.' : null,
      email: !email.trim()
        ? 'Email is required.'
        : !isEmailValid
          ? 'Enter a valid email address (e.g. name@example.com).'
          : null,
      password: !password
        ? 'Password is required.'
        : isSignUp && password.length < 6
          ? 'Password must be at least 6 characters.'
          : isSignUp && !PASSWORD_COMPLEXITY_RE.test(password)
            ? 'Password must include at least one lowercase letter, one uppercase letter, and one number.'
            : null,
      confirmPassword:
        isSignUp && !confirmPassword
          ? 'Please confirm your password.'
          : isSignUp && confirmPassword !== password
            ? 'Passwords do not match.'
            : null,
    }),
    [isSignUp, firstName, lastName, email, isEmailValid, password, confirmPassword],
  )
  const shouldShowNameErrors = useMemo(() => {
    if (!isSignUp) return false
    return (
      touched.firstName ||
      touched.lastName ||
      email.trim().length > 0 ||
      password.length > 0 ||
      phone.trim().length > 0 ||
      Boolean(dateOfBirth)
    )
  }, [isSignUp, touched.firstName, touched.lastName, email, password, phone, dateOfBirth])
  const hasFieldErrors = useMemo(
    () =>
      Boolean(
        fieldErrors.firstName ||
          fieldErrors.lastName ||
          fieldErrors.email ||
          fieldErrors.password ||
          fieldErrors.confirmPassword,
      ),
    [fieldErrors],
  )

  const disabled = useMemo(() => busy, [busy])

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current)
      }
      if (revealConfirmTimerRef.current) {
        clearTimeout(revealConfirmTimerRef.current)
      }
    }
  }, [])

  if (loading) {
    return (
      <AppTiledBackground>
        <View style={styles.centered}>
          <AppLogo />
          <ActivityIndicator color={ACCENT} />
        </View>
      </AppTiledBackground>
    )
  }
  if (user) return <Redirect href="/(tabs)" />

  const onSubmit = async () => {
    setError(null)
    setInfo(null)
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      password: true,
      confirmPassword: true,
    })
    if (hasFieldErrors) return
    setBusy(true)
    try {
      if (isSignUp) {
        const res = await signUp({
          firstName,
          lastName,
          email,
          password,
          phone: phone.trim() || undefined,
          dateOfBirth,
        })
        if (res.error) {
          const e = res.error.toLowerCase()
          if (e.includes('already') || e.includes('registered') || e.includes('exists')) {
            setError('An account with this email already exists. Try signing in or resend confirmation.')
          } else {
            setError(res.error)
          }
        }
        else setInfo(res.info ?? 'Account created.')
      } else {
        const res = await signIn(email, password)
        if (res.error) setError(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppTiledBackground>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.content}>
          <Text style={styles.title}>Nudge</Text>
          <Text style={styles.sub}>{isSignUp ? 'Create your account' : 'Sign in to continue'}</Text>
          <View style={styles.logoWrap}>
            <AppLogo />
          </View>

          {isSignUp ? (
            <>
              <TextInput
                style={[styles.input, shouldShowNameErrors && fieldErrors.firstName ? styles.inputError : null]}
                value={firstName}
                onChangeText={(v) => {
                  setFirstName(v)
                  setTouched((t) => ({ ...t, firstName: true }))
                }}
                placeholder="First name"
                placeholderTextColor={MUTED}
              />
              {shouldShowNameErrors && fieldErrors.firstName ? (
                <FieldErrorBubble message={fieldErrors.firstName} />
              ) : null}
              <TextInput
                style={[styles.input, shouldShowNameErrors && fieldErrors.lastName ? styles.inputError : null]}
                value={lastName}
                onChangeText={(v) => {
                  setLastName(v)
                  setTouched((t) => ({ ...t, lastName: true }))
                }}
                placeholder="Last name"
                placeholderTextColor={MUTED}
              />
              {shouldShowNameErrors && fieldErrors.lastName ? (
                <FieldErrorBubble message={fieldErrors.lastName} />
              ) : null}
            </>
          ) : null}

          <TextInput
            style={[styles.input, touched.email && fieldErrors.email ? styles.inputError : null]}
            value={email}
            onChangeText={(v) => {
              setEmail(v)
              setTouched((t) => ({ ...t, email: true }))
            }}
            placeholder="Email"
            placeholderTextColor={MUTED}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          {touched.email && fieldErrors.email ? (
            <FieldErrorBubble message={fieldErrors.email} />
          ) : null}
          <View style={styles.passwordInputWrap}>
            <TextInput
              style={[styles.input, styles.passwordInput, touched.password && fieldErrors.password ? styles.inputError : null]}
              value={password}
              onChangeText={(v) => {
                setPassword(v)
                setTouched((t) => ({ ...t, password: true }))
                if (!showPassword) {
                  setRevealPasswordTemporarily(true)
                  if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
                  revealTimerRef.current = setTimeout(() => {
                    setRevealPasswordTemporarily(false)
                  }, 1000)
                }
              }}
              placeholder={isSignUp ? 'Password (min 6 chars)' : 'Password'}
              placeholderTextColor={MUTED}
              secureTextEntry={!(showPassword || revealPasswordTemporarily)}
            />
            <Pressable
              style={styles.passwordEyeBtn}
              onPress={() => {
                if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
                setRevealPasswordTemporarily(false)
                setShowPassword((v) => !v)
              }}
              hitSlop={8}
            >
              <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={MUTED} />
            </Pressable>
          </View>
          {touched.password && fieldErrors.password ? (
            <FieldErrorBubble message={fieldErrors.password} />
          ) : null}
          {isSignUp ? (
            <>
              <View style={styles.passwordInputWrap}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    touched.confirmPassword && fieldErrors.confirmPassword ? styles.inputError : null,
                  ]}
                  value={confirmPassword}
                  onChangeText={(v) => {
                    setConfirmPassword(v)
                    setTouched((t) => ({ ...t, confirmPassword: true }))
                    if (!showConfirmPassword) {
                      setRevealConfirmTemporarily(true)
                      if (revealConfirmTimerRef.current) clearTimeout(revealConfirmTimerRef.current)
                      revealConfirmTimerRef.current = setTimeout(() => {
                        setRevealConfirmTemporarily(false)
                      }, 1000)
                    }
                  }}
                  placeholder="Confirm password"
                  placeholderTextColor={MUTED}
                  secureTextEntry={!(showConfirmPassword || revealConfirmTemporarily)}
                />
                <Pressable
                  style={styles.passwordEyeBtn}
                  onPress={() => {
                    if (revealConfirmTimerRef.current) clearTimeout(revealConfirmTimerRef.current)
                    setRevealConfirmTemporarily(false)
                    setShowConfirmPassword((v) => !v)
                  }}
                  hitSlop={8}
                >
                  <Ionicons name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color={MUTED} />
                </Pressable>
              </View>
              {touched.confirmPassword && fieldErrors.confirmPassword ? (
                <FieldErrorBubble message={fieldErrors.confirmPassword} />
              ) : null}
              <Text style={styles.fieldLabel}>Date of birth (optional)</Text>
              <Pressable style={styles.input} onPress={() => setShowDobPicker(true)}>
                <Text style={[styles.dobText, !dateOfBirth && styles.dobPlaceholder]}>
                  {dateOfBirth ? formatDateForUi(dateOfBirth) : 'Select your date of birth'}
                </Text>
              </Pressable>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone number (optional)"
                placeholderTextColor={MUTED}
                keyboardType="phone-pad"
              />
            </>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {info ? <Text style={styles.info}>{info}</Text> : null}

          <Pressable onPress={onSubmit} disabled={disabled} style={[styles.btn, disabled && styles.btnDisabled]}>
            {busy ? <ActivityIndicator color={BG} /> : <Text style={styles.btnText}>{isSignUp ? 'Sign up' : 'Sign in'}</Text>}
          </Pressable>
          {isSignUp ? (
            <Pressable
              onPress={async () => {
                setError(null)
                setInfo(null)
                setResending(true)
                const res = await resendConfirmation(email)
                if (res.error) setError(res.error)
                else setInfo(res.info ?? 'Confirmation email sent.')
                setResending(false)
              }}
              style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
              disabled={resending}
            >
              <Text style={styles.switchText}>
                {resending ? 'Resending confirmation…' : 'Resend confirmation email'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => {
              setIsSignUp((v) => !v)
              setTouched({
                firstName: false,
                lastName: false,
                email: false,
                password: false,
                confirmPassword: false,
              })
              setConfirmPassword('')
              setError(null)
              setInfo(null)
              setShowPassword(false)
              setShowConfirmPassword(false)
              setRevealPasswordTemporarily(false)
              setRevealConfirmTemporarily(false)
              if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
              if (revealConfirmTimerRef.current) clearTimeout(revealConfirmTimerRef.current)
            }}
            style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Text>
          </Pressable>
        </View>
        {showDobPicker ? (
          <DateTimePicker
            value={dateOfBirth ? new Date(dateOfBirth) : new Date(1990, 0, 1)}
            mode="date"
            maximumDate={new Date()}
            onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
              setShowDobPicker(false)
              if (event.type === 'dismissed' || !selectedDate) return
              const yyyy = selectedDate.getFullYear()
              const mm = String(selectedDate.getMonth() + 1).padStart(2, '0')
              const dd = String(selectedDate.getDate()).padStart(2, '0')
              setDateOfBirth(`${yyyy}-${mm}-${dd}`)
            }}
          />
        ) : null}
      </KeyboardAvoidingView>
    </AppTiledBackground>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: 'transparent' },
  content: { paddingHorizontal: 4 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  sub: { color: MUTED, fontSize: 14, textAlign: 'center', marginBottom: 16, marginTop: 6 },
  logoWrap: { alignItems: 'center', marginBottom: 14, backgroundColor: 'transparent' },
  input: {
    backgroundColor: BG,
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderRadius: 12,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 10,
  },
  passwordInputWrap: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 42,
  },
  passwordEyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputError: {
    borderColor: '#f87171',
  },
  fieldErrorBubble: {
    marginTop: -4,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.55)',
  },
  fieldErrorText: { color: '#fca5a5', fontSize: 12, fontWeight: '600' },
  btn: { backgroundColor: ACCENT, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: BG, fontWeight: '800', fontSize: 16 },
  switchBtn: { marginTop: 12, alignItems: 'center' },
  switchBtnPressed: { opacity: 0.85 },
  switchText: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 2 },
  dobText: { color: '#fff', fontSize: 16 },
  dobPlaceholder: { color: MUTED },
  error: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  info: { color: ACCENT, fontSize: 13, marginBottom: 8 },
})
