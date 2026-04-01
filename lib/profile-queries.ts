import { supabase } from './supabase'

export type ProfileRow = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  date_of_birth: string | null
  created_at: string | null
}

export type ProfileUpsertPayload = {
  id: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  date_of_birth?: string | null
}

export async function fetchProfileByUserId(userId: string): Promise<{ data: ProfileRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,phone,date_of_birth,created_at')
    .eq('id', userId)
    .maybeSingle<ProfileRow>()

  if (error) return { data: null, error: error.message }
  return { data: data ?? null, error: null }
}

export async function upsertProfile(payload: ProfileUpsertPayload): Promise<{ error: string | null }> {
  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
  if (error) return { error: error.message }
  return { error: null }
}
