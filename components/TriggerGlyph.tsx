import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import type { StyleProp, TextStyle } from 'react-native'

import type { Nudge } from '../types'

export type NudgeTrigger = Nudge['trigger']

const GLYPH: Record<NudgeTrigger, ComponentProps<typeof Ionicons>['name']> = {
  arrive: 'log-in-outline',
  leave: 'log-out-outline',
  both: 'swap-horizontal',
}

const SEMANTIC_COLOR: Record<NudgeTrigger, string> = {
  arrive: '#22c55e',
  leave: '#ef4444',
  both: '#2dd4bf',
}

export function TriggerGlyph({
  trigger,
  size = 16,
  color,
  style,
}: {
  trigger: NudgeTrigger
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
}) {
  return (
    <Ionicons
      name={GLYPH[trigger]}
      size={size}
      color={color ?? SEMANTIC_COLOR[trigger]}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  )
}
