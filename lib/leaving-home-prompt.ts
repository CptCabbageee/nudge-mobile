import AsyncStorage from '@react-native-async-storage/async-storage'

/** User checked "Don't ask me again" and tapped No — only explicit flag suppresses the prompt. */
const NEVER_ASK_KEY = 'nudge_mobile_leaving_home_never_ask'

export async function shouldSuppressLeavingHomePrompt(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(NEVER_ASK_KEY)) === '1'
  } catch {
    return false
  }
}

export async function markLeavingHomeNeverAskAgain(): Promise<void> {
  try {
    await AsyncStorage.setItem(NEVER_ASK_KEY, '1')
  } catch {
    /* ignore */
  }
}
