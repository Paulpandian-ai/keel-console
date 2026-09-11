import { useCallback } from 'react'
import { keel, type KeelClient } from './keelClient'
import { readIdentity, type Identity } from './keelFields'
import { useKeelQuery } from './useKeelQuery'
import { useSession } from './useSession'

/**
 * Who the session's token is, according to Keel.
 *
 * `whoami` is asked once per token and base URL and shared by every page, so
 * a page mounting costs no extra call. Its `tools` list drives `can(tool)`:
 *
 *   true   Keel lists the tool for this token — offer the control
 *   false  Keel does not — disable it and say so
 *   null   not known — `whoami` is still in flight, or it failed
 *
 * `ready` says which of those two `null` means. Pages hold their reads until
 * `ready`, so a token never makes a call Keel is about to refuse just because
 * the answer had not arrived yet; once `ready`, `null` fails open — an older
 * kernel without `whoami` answers NOT_FOUND, and the console must not lock
 * itself out over a missing convenience. Keel is the enforcer either way.
 */

const cache = new Map<string, Promise<Identity>>()

export function cachedWhoami(client: KeelClient, baseUrl: string, token: string): Promise<Identity> {
  const key = `${baseUrl}\n${token}`
  let pending = cache.get(key)
  if (!pending) {
    pending = client.query<unknown>('whoami').then(readIdentity)
    cache.set(key, pending)
    // A failure is not cached: the next page to ask tries again.
    pending.catch(() => cache.delete(key))
  }
  return pending
}

/** Test hook: forget every answer. */
export function resetWhoamiCache(): void {
  cache.clear()
}

export type Can = (tool: string) => boolean | null

export function useWhoami() {
  const { baseUrl, token } = useSession()

  const query = useKeelQuery<Identity | null>(
    () => (token ? cachedWhoami(keel, baseUrl, token) : Promise.resolve(null)),
    [baseUrl, token],
  )

  const identity = query.data
  const can = useCallback<Can>(
    (tool) => (identity ? identity.tools.includes(tool) : null),
    [identity],
  )

  // With no token there is nothing to wait for.
  const ready = !token || identity !== null || query.error !== null

  return { identity, ready, loading: query.loading, error: query.error, can }
}
