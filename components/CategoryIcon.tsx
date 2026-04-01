import { Ionicons } from '@expo/vector-icons'
import type { StyleProp, TextStyle } from 'react-native'
import { iconForCategoryKey } from '../lib/categories'

const TEAL = '#00BFA5'

export function CategoryIcon({
  category,
  size = 20,
  color = TEAL,
  style,
}: {
  category: string | undefined | null
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
}) {
  return (
    <Ionicons
      name={iconForCategoryKey(category)}
      size={size}
      color={color}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  )
}
