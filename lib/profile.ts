import type { User } from '@supabase/supabase-js'

const CUSTOM_PHOTO_KEY = 'profile_photo_uri'

export function getProfileDisplayName(user: User | null): string {
  if (!user) return 'User'
  const meta = user.user_metadata ?? {}
  const fromMeta =
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
    (typeof meta.preferred_username === 'string' && meta.preferred_username.trim())
  if (fromMeta) return fromMeta
  const email = user.email?.trim()
  if (email) return email.split('@')[0] ?? email
  return 'User'
}

export function getProviderAvatarUrl(user: User | null): string | null {
  if (!user) return null
  const meta = user.user_metadata ?? {}
  const a =
    (typeof meta.avatar_url === 'string' && meta.avatar_url.trim()) ||
    (typeof meta.picture === 'string' && meta.picture.trim())
  if (a) return a
  const google = user.identities?.find((i) => i.provider === 'google')
  const id = google?.identity_data as Record<string, unknown> | undefined
  if (!id) return null
  const g =
    (typeof id.avatar_url === 'string' && id.avatar_url.trim()) ||
    (typeof id.picture === 'string' && id.picture.trim())
  return g || null
}

export function getCustomProfilePhotoUri(user: User | null): string | null {
  if (!user) return null
  const raw = user.user_metadata?.[CUSTOM_PHOTO_KEY]
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length > 0 ? t : null
}

export { CUSTOM_PHOTO_KEY }

export function profileInitial(name: string, email: string | undefined): string {
  const n = name.trim()
  if (n.length > 0) return n[0]!.toUpperCase()
  const e = email?.trim()
  if (e && e.length > 0) return e[0]!.toUpperCase()
  return '?'
}
