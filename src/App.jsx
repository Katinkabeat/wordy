import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { supabase } from './lib/supabase.js'
import { ThemeProvider, useTheme } from './contexts/ThemeContext.jsx'

// Code-split each route: only the page the user is visiting downloads
// up-front; the others fetch on demand the first time they're navigated to.
const LobbyPage = lazy(() => import('./components/lobby/LobbyPage.jsx'))
const GamePage  = lazy(() => import('./components/game/GamePage.jsx'))
const StatsPage = lazy(() => import('./components/stats/StatsPage.jsx'))
const SoloCharacterSelect = lazy(() => import('./components/solo/SoloCharacterSelect.jsx'))

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-wordy-50 dark:bg-[#0f0a1e]">
      <div className="text-center">
        <div className="text-5xl mb-4 animate-bounce">🟣</div>
        <p className="font-display text-2xl text-wordy-600 dark:text-wordy-300">Loading…</p>
      </div>
    </div>
  )
}

// Wrap in ThemeProvider so every page has access to isDark / toggle
export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}

function AppInner() {
  const { isDark } = useTheme()
  const [session, setSession] = useState(undefined) // undefined = loading
  // Detect password-recovery link from the URL hash synchronously so we can
  // redirect to the SQ hub (which owns the recovery form) before Supabase
  // consumes the hash and swaps it for a session token.
  const [isRecovery] = useState(
    () => window.location.hash.includes('type=recovery')
  )

  useEffect(() => {
    // Safety timeout: if getSession() hangs (e.g. orphaned navigator.locks),
    // fall back to the redirect path after 5 seconds.
    const timeout = setTimeout(() => {
      setSession(s => (s === undefined ? null : s))
    }, 5000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout)
      setSession(session?.user ? session : null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      clearTimeout(timeout)
      setSession(s?.user ? s : null)
    })
    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  // Phase 2: Wordy no longer hosts a login UI of any kind. Redirect logged-out
  // users — and legacy `/wordy/#type=recovery` emails issued before Phase 0 —
  // to the SQ hub, which owns the entire auth surface now.
  useEffect(() => {
    if (isRecovery) {
      // Preserve the full recovery hash so SQ's recovery handler picks it up.
      window.location.replace(`${window.location.origin}/games/${window.location.hash}`)
    } else if (session === null) {
      const ret = window.location.pathname + window.location.search
      window.location.replace(`${window.location.origin}/games/?return=${encodeURIComponent(ret)}`)
    }
  }, [session, isRecovery])

  if (session === undefined && !isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50 dark:bg-[#0f0a1e]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🟣</div>
          <p className="font-display text-2xl text-wordy-600 dark:text-wordy-300">Loading Wordy…</p>
        </div>
      </div>
    )
  }

  if (session === null || isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50 dark:bg-[#0f0a1e]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🟣</div>
          <p className="font-display text-2xl text-wordy-600 dark:text-wordy-300">Redirecting to login…</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            fontFamily: 'Nunito, sans-serif', borderRadius: '12px',
            background: isDark ? '#1a1130' : undefined,
            color:      isDark ? '#ede0ff' : undefined,
            border:     isDark ? '1px solid #3d2070' : undefined,
          },
          success: { style: isDark
            ? { background: '#1a1130', color: '#c4b5fd', border: '1px solid #6d28d9' }
            : { background: '#f3e8ff', color: '#581c87', border: '1px solid #c084fc' } },
          error: { style: isDark
            ? { background: '#2d0a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }
            : { background: '#fff1f2', color: '#9f1239', border: '1px solid #fda4af' } },
        }}
      />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/lobby"     element={<LobbyPage session={session} />} />
          <Route path="/solo"      element={<SoloCharacterSelect session={session} />} />
          <Route path="/game/:id"  element={<GamePage  session={session} />} />
          <Route path="/stats"     element={<StatsPage session={session} />} />
          <Route path="*"         element={<Navigate to="/lobby" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
