//
// auth.tsx — client-side auth: talks to /api/auth/*, exposes the current user
// via context, and gates the app. Cookies are httpOnly (set by the server), so
// this never touches the token directly.
//

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export interface User {
  id: string
  email: string
  displayName: string | null
  createdAt: number
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const authApi = {
  signup: (email: string, password: string, displayName?: string) =>
    post('/api/auth/signup', { email, password, displayName }).then((d) => d.user as User),
  login: (email: string, password: string) =>
    post('/api/auth/login', { email, password }).then((d) => d.user as User),
  logout: () => post('/api/auth/logout', {}),
  me: async (): Promise<User | null> => {
    const res = await fetch('/api/auth/me', { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()).user as User
  }
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null, loading: true, refresh: async () => {}, logout: async () => {}
})

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setUser(await authApi.me()) } finally { setLoading(false) }
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setUser(null)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
