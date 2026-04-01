import AsyncStorage from '@react-native-async-storage/async-storage'
import { snapMetersToStep, type RadiusMeters } from './nudge-radius'

const PREFIX = 'nudge_mobile_pref_'

const KEYS = {
  notifyArrive: `${PREFIX}notify_arrive`,
  notifyLeave: `${PREFIX}notify_leave`,
  notifyBoth: `${PREFIX}notify_both`,
  defaultRadius: `${PREFIX}default_radius_m`,
  mapStyle: `${PREFIX}map_style`,
} as const

export type MapStylePreference = 'standard' | 'satellite'

export const DEFAULT_RADIUS_OPTIONS = [10, 15, 20, 25, 30, 50, 75, 100] as const
export type DefaultRadiusOption = (typeof DEFAULT_RADIUS_OPTIONS)[number]

const DEFAULTS = {
  notifyArrive: true,
  notifyLeave: true,
  notifyBoth: true,
  defaultRadius: 25 as DefaultRadiusOption,
  mapStyle: 'standard' as MapStylePreference,
}

async function getBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(key)
    if (v === null) return fallback
    return v === '1'
  } catch {
    return fallback
  }
}

async function setBool(key: string, value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export async function loadNotificationPreferences(): Promise<{
  notifyArrive: boolean
  notifyLeave: boolean
  notifyBoth: boolean
}> {
  const [notifyArrive, notifyLeave, notifyBoth] = await Promise.all([
    getBool(KEYS.notifyArrive, DEFAULTS.notifyArrive),
    getBool(KEYS.notifyLeave, DEFAULTS.notifyLeave),
    getBool(KEYS.notifyBoth, DEFAULTS.notifyBoth),
  ])
  return { notifyArrive, notifyLeave, notifyBoth }
}

export async function saveNotifyArrive(value: boolean): Promise<void> {
  await setBool(KEYS.notifyArrive, value)
}

export async function saveNotifyLeave(value: boolean): Promise<void> {
  await setBool(KEYS.notifyLeave, value)
}

export async function saveNotifyBoth(value: boolean): Promise<void> {
  await setBool(KEYS.notifyBoth, value)
}

export async function loadDefaultRadiusMeters(): Promise<RadiusMeters> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.defaultRadius)
    if (raw == null) return snapMetersToStep(DEFAULTS.defaultRadius)
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return snapMetersToStep(DEFAULTS.defaultRadius)
    return snapMetersToStep(n)
  } catch {
    return snapMetersToStep(DEFAULTS.defaultRadius)
  }
}

export async function saveDefaultRadiusMeters(meters: number): Promise<void> {
  try {
    const m = snapMetersToStep(meters)
    await AsyncStorage.setItem(KEYS.defaultRadius, String(m))
  } catch {
    /* ignore */
  }
}

export async function loadMapStylePreference(): Promise<MapStylePreference> {
  try {
    const v = await AsyncStorage.getItem(KEYS.mapStyle)
    if (v === 'satellite') return 'satellite'
    return 'standard'
  } catch {
    return DEFAULTS.mapStyle
  }
}

export async function saveMapStylePreference(style: MapStylePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.mapStyle, style)
  } catch {
    /* ignore */
  }
}
