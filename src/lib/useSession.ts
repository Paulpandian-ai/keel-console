import { useCallback, useSyncExternalStore } from 'react'
import {
  clearSession,
  getBaseUrl,
  getToken,
  isBaseUrlOverridden,
  setBaseUrl,
  setToken,
  subscribe,
} from './session'

/** Reactive view of the session (token + base URL) for components. */
export function useSession() {
  const baseUrl = useSyncExternalStore(subscribe, getBaseUrl, () => getBaseUrl())
  const token = useSyncExternalStore(subscribe, getToken, () => null)
  const overridden = useSyncExternalStore(subscribe, isBaseUrlOverridden, () => false)

  return {
    baseUrl,
    token,
    hasToken: token !== null,
    isBaseUrlOverridden: overridden,
    setToken: useCallback((value: string) => setToken(value), []),
    setBaseUrl: useCallback((value: string) => setBaseUrl(value), []),
    clearSession: useCallback(() => clearSession(), []),
  }
}
