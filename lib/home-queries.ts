import { supabase } from './supabase'

export type UserHomeRow = {
  id: string
  name: string
  lat: number
  lng: number
  radius_meters: number
}

export async function fetchUserHome(
  userId: string,
): Promise<{ data: UserHomeRow | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('locations')
    .select('id, name, lat, lng, radius_meters')
    .eq('user_id', userId)
    .eq('is_home', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    return { data: null, error: new Error(error.message) }
  }
  if (!data) return { data: null, error: null }
  const row = data as UserHomeRow
  return { data: row, error: null }
}

export async function upsertUserHome(
  userId: string,
  payload: { name: string; lat: number; lng: number; radiusMeters?: number },
): Promise<{ data: UserHomeRow | null; error: Error | null }> {
  const r = Math.round(payload.radiusMeters ?? 75)

  const { data: existing, error: selErr } = await supabase
    .from('locations')
    .select('id')
    .eq('user_id', userId)
    .eq('is_home', true)
    .limit(1)
    .maybeSingle()

  if (selErr) {
    return { data: null, error: new Error(selErr.message) }
  }

  if (existing?.id) {
    const { data: updated, error: upErr } = await supabase
      .from('locations')
      .update({
        name: payload.name.trim() || 'Home',
        lat: payload.lat,
        lng: payload.lng,
        radius_meters: r,
      })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select('id, name, lat, lng, radius_meters')
      .single()

    if (upErr) return { data: null, error: new Error(upErr.message) }
    return { data: updated as UserHomeRow, error: null }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('locations')
    .insert({
      user_id: userId,
      name: payload.name.trim() || 'Home',
      lat: payload.lat,
      lng: payload.lng,
      radius_meters: r,
      is_home: true,
    })
    .select('id, name, lat, lng, radius_meters')
    .single()

  if (insErr) return { data: null, error: new Error(insErr.message) }
  return { data: inserted as UserHomeRow, error: null }
}

/** Deletes the home location and all nudges tied to that location (including the leaving-home nudge). */
export async function deleteUserHome(
  userId: string,
  homeLocationId: string,
): Promise<{ error: Error | null }> {
  const { error: nErr } = await supabase
    .from('nudges')
    .delete()
    .eq('user_id', userId)
    .eq('location_id', homeLocationId)
  if (nErr) return { error: new Error(nErr.message) }

  const { error: lErr } = await supabase
    .from('locations')
    .delete()
    .eq('id', homeLocationId)
    .eq('user_id', userId)
    .eq('is_home', true)
  if (lErr) return { error: new Error(lErr.message) }
  return { error: null }
}
