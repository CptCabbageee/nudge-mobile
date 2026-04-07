import { Image, View } from 'react-native'

type AppLogoProps = {
  size?: number
}

export function AppLogo({ size = 120 }: AppLogoProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: 'transparent',
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Image
        source={require('../assets/images/logo.png')}
        style={{ width: size * 0.85, height: size * 0.85, backgroundColor: 'transparent' }}
        resizeMode="contain"
      />
    </View>
  )
}
