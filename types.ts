export interface Nudge {
  id: string
  user_id: string
  location_id: string
  title: string
  notes?: string
  trigger: 'arrive' | 'leave' | 'both'
  radius_meters: number
  category?: string
  is_active: boolean
  created_at: string
}
  
  export interface Location {
    id: string
    user_id: string
    name: string
    lat: number
    lng: number
    radius_meters: number
    created_at: string
  }
  
  export interface SearchResult {
    lat: number
    lng: number
    name: string
    display_name: string
  }