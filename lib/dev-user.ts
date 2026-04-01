/**
 * When auth is bypassed for development, Supabase rows still need a user_id.
 * Replace with a real test user UUID from your project before relying on RLS/data.
 */
export const DEV_FALLBACK_USER_ID = '00000000-0000-4000-8000-000000000001'

export function effectiveUserId(sessionUserId: string | undefined | null): string {
  if (sessionUserId && sessionUserId.trim().length > 0) return sessionUserId.trim()
  return DEV_FALLBACK_USER_ID
}
