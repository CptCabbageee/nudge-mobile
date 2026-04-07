import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite'
import type { MapPoi } from './poi-fetch'

const DB_NAME = 'poi-area-cache.db'
const MAX_AREAS = 30

let dbReady: Promise<SQLiteDatabase> | null = null

function getDb(): Promise<SQLiteDatabase> {
  if (!dbReady) {
    dbReady = openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS poi_area_cache (
          area_key TEXT PRIMARY KEY NOT NULL,
          pois_json TEXT NOT NULL,
          visit_count INTEGER NOT NULL DEFAULT 0,
          last_used INTEGER NOT NULL
        );
      `)
      return db
    }).catch((e) => {
      dbReady = null
      throw e
    })
  }
  return dbReady
}

/** Cache bucket: map centre rounded to 2 decimal degrees (~1.1 km lat). */
export function poiAreaCacheKey(lat: number, lng: number): string {
  return `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}`
}

function parsePoisJson(json: string): MapPoi[] {
  try {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) return []
    return raw as MapPoi[]
  } catch {
    return []
  }
}

/** Read cached POIs without bumping visit_count (for prefetch checks). */
export async function peekPoiAreaCache(areaKey: string): Promise<MapPoi[] | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ pois_json: string }>(
    'SELECT pois_json FROM poi_area_cache WHERE area_key = ?',
    [areaKey],
  )
  if (!row) return null
  return parsePoisJson(row.pois_json)
}

/**
 * Increment visit count, bump last_used, return parsed POIs and new visit_count.
 * Returns null if no row for this area.
 */
export async function touchAndReadPoiAreaCache(
  areaKey: string,
): Promise<{ pois: MapPoi[]; visitCount: number } | null> {
  const db = await getDb()
  const now = Date.now()
  const before = await db.getFirstAsync<{ pois_json: string; visit_count: number }>(
    'SELECT pois_json, visit_count FROM poi_area_cache WHERE area_key = ?',
    [areaKey],
  )
  if (!before) return null
  await db.runAsync(
    'UPDATE poi_area_cache SET visit_count = visit_count + 1, last_used = ? WHERE area_key = ?',
    [now, areaKey],
  )
  const visitCount = before.visit_count + 1
  return { pois: parsePoisJson(before.pois_json), visitCount }
}

/** Persist POIs for an area; LRU-evicts one row if at cap and this is a new key. */
export async function putPoiAreaCache(areaKey: string, pois: MapPoi[]): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const json = JSON.stringify(pois)

  const exists = await db.getFirstAsync<{ area_key: string }>(
    'SELECT area_key FROM poi_area_cache WHERE area_key = ?',
    [areaKey],
  )
  if (!exists) {
    const cntRow = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM poi_area_cache')
    if ((cntRow?.c ?? 0) >= MAX_AREAS) {
      await db.runAsync(
        `DELETE FROM poi_area_cache WHERE area_key = (
          SELECT area_key FROM poi_area_cache ORDER BY last_used ASC LIMIT 1
        )`,
      )
    }
  }

  await db.runAsync(
    `INSERT INTO poi_area_cache (area_key, pois_json, visit_count, last_used)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(area_key) DO UPDATE SET
       pois_json = excluded.pois_json,
       last_used = excluded.last_used`,
    [areaKey, json, now],
  )
}

/** Clears all cached POI area rows (e.g. after fixing empty-cache poisoning). */
export async function clearAllPoiAreaCache(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM poi_area_cache')
}
