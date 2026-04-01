import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { AuthProvider } from '../context/AuthContext'
import { LeavingHomePromptProvider } from '../context/LeavingHomePromptContext'

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <LeavingHomePromptProvider>
            <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false }}>
              {/* TODO: Re-enable auth before launch. */}
              <Stack.Screen name="auth" />
              <Stack.Screen name="(tabs)" />
            </Stack>
          </LeavingHomePromptProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  )
}
