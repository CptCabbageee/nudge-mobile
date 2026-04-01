import { Image } from 'expo-image'

type AppLogoProps = {
  /** Header / modal = 60; full-screen splash / auth = 120 */
  size?: 60 | 120
}

/**
 * Logo asset: expo-image preserves PNG alpha on Android better than RN Image.
 */
export function AppLogo({ size = 120 }: AppLogoProps) {
  return (
    <Image
      source={require('../assets/images/logo.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      transition={0}
      tintColor={undefined}
      cachePolicy="memory-disk"
      allowDownscaling={false}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  )
}
