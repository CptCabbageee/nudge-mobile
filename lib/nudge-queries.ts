import { supabase } from './supabase'

export type NudgeListItem = {
  id: string
  user_id: string
  location_id: string
  title: string
  notes: string | null
  trigger: 'arrive' | 'leave' | 'both'
  radius_meters: number
  category: string | null
  is_active: boolean
  created_at: string
  location_name: string
  lat: number
  lng: number
}

type LocationEmbed = {
  id: string
  name: string
  lat: number
  lng: number
  radius_meters: number
  is_home?: boolean | null
}

type NudgeRow = {
  id: string
  user_id: string
  location_id: string
  title: string
  notes: string | null
  trigger_type: 'arrive' | 'leave' | 'both'
  radius_meters: number
  category: string | null
  is_active: boolean
  created_at: string
  time_window_start: string | null
  time_window_end: string | null
  locations: LocationEmbed | LocationEmbed[] | null
}

function normalizeLocation(
  loc: LocationEmbed | LocationEmbed[] | null | undefined,
): LocationEmbed | null {
  if (!loc) return null
  return Array.isArray(loc) ? loc[0] ?? null : loc
}

function mapRow(row: NudgeRow): NudgeListItem | null {
  const loc = normalizeLocation(row.locations)
  if (!loc) return null
  return {
    id: row.id,
    user_id: row.user_id,
    location_id: row.location_id,
    title: row.title,
    notes: row.notes,
    trigger: row.trigger_type,
    radius_meters: row.radius_meters,
    category: row.category,
    is_active: row.is_active,
    created_at: row.created_at,
    location_name: loc.name,
    lat: loc.lat,
    lng: loc.lng,
  }
}

export async function fetchUserNudges(userId: string): Promise<{ data: NudgeListItem[]; error: Error | null }> {
  const { data, error } = await supabase
    .from('nudges')
    .select(
      `
      id,
      user_id,
      location_id,
      title,
      notes,
      category,
      trigger_type,
      radius_meters,
      time_window_start,
      time_window_end,
      is_active,
      created_at,
      locations ( id, name, lat, lng, radius_meters, is_home )
    `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return { data: [], error: new Error(error.message) }
  }

  const rows = (data ?? []) as unknown as NudgeRow[]
  const list = rows.map(mapRow).filter((x): x is NudgeListItem => x !== null)
  return { data: list, error: null }
}

export async function deleteNudgeForUser(userId: string, nudgeId: string): Promise<{ error: Error | null }> {
  const { data: row, error: selErr } = await supabase
    .from('nudges')
    .select('location_id')
    .eq('id', nudgeId)
    .eq('user_id', userId)
    .single()

  if (selErr || !row) {
    return { error: new Error(selErr?.message ?? 'Nudge not found') }
  }

  const { data: loc, error: locSelErr } = await supabase
    .from('locations')
    .select('is_home')
    .eq('id', row.location_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (locSelErr) {
    return { error: new Error(locSelErr.message) }
  }

  const { error: delN } = await supabase.from('nudges').delete().eq('id', nudgeId).eq('user_id', userId)
  if (delN) return { error: new Error(delN.message) }

  if (loc && loc.is_home !== true) {
    await supabase.from('locations').delete().eq('id', row.location_id).eq('user_id', userId)
  }

  return { error: null }
}

export type NudgeSaveFields = {
  title: string
  notes: string
  location: string
  coordinates: { lat: number; lng: number }
  trigger: 'arrive' | 'leave' | 'both'
  radius_meters: number
  category: string
}

export async function updateNudgeForUser(
  userId: string,
  nudgeId: string,
  locationId: string,
  payload: NudgeSaveFields,
): Promise<{ error: Error | null }> {
  const r = Math.round(payload.radius_meters)

  const { error: locErr } = await supabase
    .from('locations')
    .update({
      name: payload.location.trim() || payload.title.trim(),
      radius_meters: r,
    })
    .eq('id', locationId)
    .eq('user_id', userId)

  if (locErr) return { error: new Error(locErr.message) }

  const { error: nudgeErr } = await supabase
    .from('nudges')
    .update({
      title: payload.title.trim(),
      notes: payload.notes.trim() || null,
      trigger_type: payload.trigger,
      radius_meters: r,
      category: payload.category,
    })
    .eq('id', nudgeId)
    .eq('user_id', userId)

  if (nudgeErr) return { error: new Error(nudgeErr.message) }
  return { error: null }
}

/** Default "leaving home" nudge tied to the user's home `locations` row (`is_home` true). */
export async function createLeavingHomeNudgeIfAbsent(
  userId: string,
  homeLocationId: string,
  homeRadiusMeters: number,
): Promise<{ error: Error | null }> {
  const { data: existingRows, error: existingErr } = await supabase
    .from('nudges')
    .select('id')
    .eq('user_id', userId)
    .eq('location_id', homeLocationId)
    .eq('trigger_type', 'leave')
    .limit(1)

  if (!existingErr && existingRows && existingRows.length > 0) {
    return { error: null }
  }

  const r = Math.round(homeRadiusMeters)
  const { error } = await supabase.from('nudges').insert({
    user_id: userId,
    location_id: homeLocationId,
    title: 'Leaving home',
    notes: null,
    trigger_type: 'leave',
    radius_meters: r,
    category: '⭐',
    time_window_start: null,
    time_window_end: null,
    is_active: true,
  })

  if (error) return { error: new Error(error.message) }
  return { error: null }
}

export async function hasLeavingHomeNudge(userId: string, homeLocationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('nudges')
    .select('id')
    .eq('user_id', userId)
    .eq('location_id', homeLocationId)
    .eq('trigger_type', 'leave')
    .limit(1)

  if (error) return false
  return (data?.length ?? 0) > 0
}
