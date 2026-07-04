//
// AuthGate — shows the login/signup screen until the user is authenticated,
// then renders the app. This is what makes it a multi-user site: no session,
// no data.
//

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import LoginScreen from '../screens/LoginScreen'

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-950 text-ink-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (!user) return <LoginScreen />
  return <>{children}</>
}
