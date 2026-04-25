import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { supabase } from './lib/supabase.js'
import { ThemeProvider, useTheme } from './contexts/ThemeContext.jsx'
import AuthPage  from './components/auth/AuthPage.jsx'
import LobbyPage from './components/lobby/LobbyPage.jsx'
import GamePage  from './components/game/GamePage.jsx'
import StatsPage from './components/stats/StatsPage.jsx'

// Only redirect to the SQ hub login when we're actually deployed alongside it.
// Local dev (vite dev / vite preview on localhost) keeps the in-app login UI.
function shouldRedirectToHub() {
  return window.location.hostname === 'katinkabeat.github.io'
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
  const [session, setSession]     = useState(undefined) // undefined = loading
  // Detect password-recovery link immediately from the URL hash — before the
  // async getSession() resolves — so we never accidentally redirect to /lobby
  // (or to the SQ hub login).
  const [isRecovery, setIsRecovery] = useState(
    () => window.location.hash.includes('type=recovery')
  )

  useEffect(() => {
    // Safety timeout: if getSession() hangs (e.g. orphaned navigator.locks),
    // fall back to the auth page after 5 seconds instead of spinning forever.
    const timeout = setTimeout(() => {
      setSession(s => (s === undefined ? null : s))
    }, 5000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout)
      // Treat sessions with no user data as invalid
      setSession(session?.user ? session : null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      clearTimeout(timeout)
      setSession(s?.user ? s : null)
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
    })
    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  // Phase 1: Wordy no longer hosts its own login UI for unauthed users — it
  // sends them to the SQ hub with a ?return= param so they land back here
  // after authenticating. Recovery emails sent before the migration still
  // land at /wordy/auth and use the in-app recovery form below.
  // The hub-redirect only runs in production (where /games/ is the SQ app);
  // in local dev the in-app login form remains the working entry point.
  useEffect(() => {
    if (session === null && !isRecovery && shouldRedirectToHub()) {
      const ret = window.location.pathname + window.location.search
      const sqLogin = `${window.location.origin}/games/?return=${encodeURIComponent(ret)}`
      window.location.replace(sqLogin)
    }
  }, [session, isRecovery])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50 dark:bg-[#0f0a1e]">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🟣</div>
          <p className="font-display text-2xl text-wordy-600 dark:text-wordy-300">Loading Wordy…</p>
        </div>
      </div>
    )
  }

  if (session === null && !isRecovery && shouldRedirectToHub()) {
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
      <Routes>
        <Route path="/auth"       element={
          (!session || isRecovery)
            ? <AuthPage isRecovery={isRecovery} onPasswordReset={() => setIsRecovery(false)} />
            : <Navigate to="/lobby" replace />
        } />
        <Route path="/lobby"      element={session  ? <LobbyPage session={session} /> : <Navigate to="/auth" replace />} />
        <Route path="/game/:id"   element={session  ? <GamePage  session={session} /> : <Navigate to="/auth" replace />} />
        <Route path="/stats"      element={session  ? <StatsPage session={session} /> : <Navigate to="/auth" replace />} />
        <Route path="*"           element={<Navigate to={isRecovery ? '/auth' : session ? '/lobby' : '/auth'} replace />} />
      </Routes>
    </>
  )
}
