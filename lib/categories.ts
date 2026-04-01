import type { ComponentProps } from 'react'
import { Ionicons } from '@expo/vector-icons'

export const CATEGORY_KEYS = [
  '🛒',
  '🍺',
  '🍽️',
  '💊',
  '🏦',
  '📦',
  '🚗',
  '🚂',
  '👤',
  '💼',
  '⭐',
] as const

export type CategoryKey = (typeof CATEGORY_KEYS)[number]

export const CATEGORIES: CategoryKey[] = [...CATEGORY_KEYS]

export const DEFAULT_CATEGORY_KEY: CategoryKey = '⭐'

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  '🛒': 'Shopping',
  '🍺': 'Pub / Bar',
  '🍽️': 'Food & Drink',
  '💊': 'Pharmacy',
  '🏦': 'Bank',
  '📦': 'Post',
  '🚗': 'Parking',
  '🚂': 'Transport',
  '👤': 'Personal',
  '💼': 'Work',
  '⭐': 'Other',
}

export type IonName = ComponentProps<typeof Ionicons>['name']

export const CATEGORY_ION: Record<CategoryKey, IonName> = {
  '🛒': 'cart-outline',
  '🍺': 'beer-outline',
  '🍽️': 'restaurant-outline',
  '💊': 'medkit-outline',
  '🏦': 'business-outline',
  '📦': 'mail-outline',
  '🚗': 'car-outline',
  '🚂': 'train-outline',
  '👤': 'person-outline',
  '💼': 'briefcase-outline',
  '⭐': 'star-outline',
}

const EXTRA_POI_ION: Record<string, IonName> = {
  '🚌': 'bus-outline',
  '✈️': 'airplane-outline',
  '🚢': 'boat-outline',
  '🚖': 'car-sport-outline',
  '🏠': 'home-outline',
}

export function iconForCategoryKey(key: string | undefined | null): IonName {
  const k = key || DEFAULT_CATEGORY_KEY
  return EXTRA_POI_ION[k] ?? CATEGORY_ION[k as CategoryKey] ?? CATEGORY_ION[DEFAULT_CATEGORY_KEY]
}
