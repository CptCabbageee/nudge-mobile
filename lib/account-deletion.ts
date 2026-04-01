import { supabase } from './supabase'

/**
 * Deletes application data for the current user (nudges, locations).
 * Auth user removal requires a Supabase Edge Function with service role.
 */
export async function deleteAllUserApplicationData(userId: string): Promise<{ error: Error | null }> {
  const { error: nErr } = await supabase.from('nudges').delete().eq('user_id', userId)
  if (nErr) return { error: new Error(nErr.message) }

  const { error: lErr } = await supabase.from('locations').delete().eq('user_id', userId)
  if (lErr) return { error: new Error(lErr.message) }

  return { error: null }
}
