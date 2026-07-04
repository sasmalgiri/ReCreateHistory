//
// km.ts — typed access to the backend bridge, plus small data hooks used by
// every screen. `km` is the preload-exposed window.km; useAsync runs a query
// on mount and tracks loading/error/data.
//

import { useCallback, useEffect, useRef, useState } from 'react'

export const km = window.km

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fnRef.current()
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const cleanup = run()
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, reload: run }
}
