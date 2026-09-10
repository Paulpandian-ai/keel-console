/**
 * Session-scoped console configuration.
 *
 * Non-negotiable #3: the Keel token lives in `sessionStorage` only. It is never
 * written to disk, never placed in a URL, never logged, and never bundled.
 * Closing the tab ends the session.
 */

const TOKEN_KEY = 'keel.token'
const BASE_URL_KEY = 'keel.base_url'

/** Build-time default; the user may override it at runtime in Settings. */
export const DEFAULT_BASE_URL: string =
  import.meta.env.VITE_KEEL_URL ?? 'https://headless-erp-production-0480.up.railway.app'

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribe to session changes (for `useSyncExternalStore`). */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * sessionStorage throws in some privacy modes and in non-browser contexts, so
 * every access is guarded and degrades to "no session".
 */
function read(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.sessionStorage?.removeItem(key)
    else globalThis.sessionStorage?.setItem(key, value)
  } catch {
    // Storage unavailable: the value stays for this page view only.
  }
  emit()
}

export function getToken(): string | null {
  const token = read(TOKEN_KEY)
  return token && token.length > 0 ? token : null
}

export function setToken(token: string): void {
  write(TOKEN_KEY, token.trim() || null)
}

export function hasToken(): boolean {
  return getToken() !== null
}

/** Strip the base URL to its origin+path root and drop any trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

export function getBaseUrl(): string {
  return read(BASE_URL_KEY) ?? DEFAULT_BASE_URL
}

export function setBaseUrl(url: string): void {
  const normalized = normalizeBaseUrl(url)
  write(BASE_URL_KEY, normalized === DEFAULT_BASE_URL || normalized === '' ? null : normalized)
}

export function isBaseUrlOverridden(): boolean {
  return read(BASE_URL_KEY) !== null
}

/** Clear the token and any base-URL override. */
export function clearSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(TOKEN_KEY)
    globalThis.sessionStorage?.removeItem(BASE_URL_KEY)
  } catch {
    // ignore
  }
  emit()
}

/** Show only the shape of a token, never its body. */
export function maskToken(token: string): string {
  if (token.length <= 8) return '•'.repeat(token.length)
  return `${token.slice(0, 4)}${'•'.repeat(Math.min(24, token.length - 8))}${token.slice(-4)}`
}
