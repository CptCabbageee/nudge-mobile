import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

const CHUNK_SIZE = 1800

const LargeSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      const chunkCount = await SecureStore.getItemAsync(`${key}_chunks`)
      if (!chunkCount) {
        try {
          return await SecureStore.getItemAsync(key)
        } catch {
          return null
        }
      }
      const parsed = Number.parseInt(chunkCount, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.log('[Startup][SecureStore] invalid chunk count, falling back to base key', {
          key,
          chunkCount,
        })
        try {
          return await SecureStore.getItemAsync(key)
        } catch {
          return null
        }
      }
      const chunks = []
      for (let i = 0; i < parsed; i++) {
        try {
          const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`)
          if (chunk) chunks.push(chunk)
        } catch {
          /* ignore chunk read errors */
        }
      }
      return chunks.join('')
    } catch (e) {
      console.log('[Startup][SecureStore] getItem failed', key, e instanceof Error ? e.message : e)
      return null
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.deleteItemAsync(`${key}_chunks`)
        return SecureStore.setItemAsync(key, value)
      }
      const chunks = []
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE))
      }
      await SecureStore.setItemAsync(`${key}_chunks`, String(chunks.length))
      for (let i = 0; i < chunks.length; i++) {
        await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunks[i])
      }
    } catch (e) {
      console.log('[Startup][SecureStore] setItem failed', key, e instanceof Error ? e.message : e)
    }
  },
  removeItem: async (key: string) => {
    try {
      const chunkCount = await SecureStore.getItemAsync(`${key}_chunks`)
      const parsed = chunkCount ? Number.parseInt(chunkCount, 10) : 0
      if (Number.isFinite(parsed) && parsed > 0) {
        for (let i = 0; i < parsed; i++) {
          await SecureStore.deleteItemAsync(`${key}_chunk_${i}`)
        }
        await SecureStore.deleteItemAsync(`${key}_chunks`)
      }
      return SecureStore.deleteItemAsync(key)
    } catch (e) {
      console.log('[Startup][SecureStore] removeItem failed', key, e instanceof Error ? e.message : e)
    }
  },
}

/** For inserts/selects scoped to the signed-in user, use `requireUserId()` from `./require-user`. */
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: LargeSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
)