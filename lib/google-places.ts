import type { SearchResult } from '../types'

type GooglePlaceSuggestion = {
  placeId: string
  description: string
}

function getGooglePlacesApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY
  return key?.trim() || null
}

/** https://maps.googleapis.com/maps/api/place/autocomplete/json?input=…&key=…&components=country:gb&location=LAT,LNG&radius=50000 */
function autocompleteUrl(input: string, key: string, lat: number, lng: number): string {
  const enc = encodeURIComponent(input)
  return `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${enc}&key=${key}&components=country:gb&location=${lat},${lng}&radius=50000`
}

/** https://maps.googleapis.com/maps/api/place/details/json?place_id=…&key=…&fields=geometry,formatted_address */
function detailsUrl(placeId: string, key: string): string {
  const pid = encodeURIComponent(placeId)
  return `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&key=${key}&fields=geometry,formatted_address`
}

/**
 * Google Places Autocomplete suggestions (address-focused).
 * Biased to the UK + current map centre using location+radius.
 */
export async function fetchGooglePlaceAutocompleteSuggestions(
  term: string,
  mapLat: number,
  mapLng: number,
  signal?: AbortSignal,
): Promise<GooglePlaceSuggestion[]> {
  const q = term.trim()
  if (!q) return []

  const apiKey = getGooglePlacesApiKey()
  if (!apiKey) return []

  const url = autocompleteUrl(q, apiKey, mapLat, mapLng)
  console.log('[GooglePlaces] autocomplete key length:', apiKey.length)
  console.log('[GooglePlaces] autocomplete request URL:', url)

  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch {
    return []
  }
  if (!res.ok) return []

  const json: unknown = await res.json().catch(() => null)
  if (!json || typeof json !== 'object') return []

  const obj = json as {
    status?: string
    predictions?: { place_id: string; description: string }[]
  }

  if (obj.status && obj.status !== 'OK' && obj.status !== 'ZERO_RESULTS') return []

  const preds = obj.predictions ?? []
  return preds
    .filter((p) => Boolean(p.place_id) && Boolean(p.description))
    .map((p) => ({ placeId: p.place_id, description: p.description }))
}

/** Fetch lat/lng from Place Details for a selected place_id. */
export async function fetchGooglePlaceDetails(placeId: string, signal?: AbortSignal): Promise<SearchResult | null> {
  const apiKey = getGooglePlacesApiKey()
  if (!placeId) return null
  if (!apiKey) return null

  const url = detailsUrl(placeId, apiKey)
  console.log('[GooglePlaces] details request URL:', url)

  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch {
    return null
  }
  if (!res.ok) return null

  const json: unknown = await res.json().catch(() => null)
  if (!json || typeof json !== 'object') return null

  const obj = json as {
    status?: string
    result?: {
      formatted_address?: string
      geometry?: {
        location?: { lat?: number; lng?: number }
      }
    }
  }

  if (obj.status && obj.status !== 'OK') return null

  const lat = obj.result?.geometry?.location?.lat
  const lng = obj.result?.geometry?.location?.lng
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const formatted = String(obj.result?.formatted_address ?? '').trim()
  const name = formatted || 'Address'

  return {
    lat: lat!,
    lng: lng!,
    name,
    display_name: formatted,
  }
}

