import { supabase } from './supabase'

/**
 * Resolves the signed-in user's id for Supabase rows (`user_id`, RLS, etc.).
 * Call this right before inserts/selects that must be scoped to the current user.
 */
export async function requireUserId(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()
  if (error) {
    throw new Error(error.message)
  }
  const id = session?.user?.id
  if (!id) {
    throw new Error('Not signed in')
  }
  return id
}
