import { Image, View } from 'react-native'

type AppLogoProps = {
  size?: 60 | 120
}

export function AppLogo({ size = 120 }: AppLogoProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: 'transparent',
        overflow: 'hidden',
        borderRadius: size / 2,
      }}
    >
      <Image
        source={require('../assets/images/logo.png')}
        style={{ width: size, height: size, backgroundColor: 'transparent' }}
        resizeMode="contain"
      />
    </View>
  )
}
