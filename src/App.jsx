import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { supabase } from './lib/supabase.js'
import AuthPage  from './components/auth/AuthPage.jsx'
import LobbyPage from './components/lobby/LobbyPage.jsx'
import GamePage  from './components/game/GamePage.jsx'
import StatsPage from './components/stats/StatsPage.jsx'

export default function App() {
  const [session, setSession]     = useState(undefined) // undefined = loading
  // Detect password-recovery link immediately from the URL hash — before the
  // async getSession() resolves — so we never accidentally redirect to /lobby.
  const [isRecovery, setIsRecovery] = useState(
    () => window.location.hash.includes('type=recovery')
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-wordy-50">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🟣</div>
          <p className="font-display text-2xl text-wordy-600">Loading Wordy…</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: { fontFamily: 'Nunito, sans-serif', borderRadius: '12px' },
          success: { style: { background: '#f3e8ff', color: '#581c87', border: '1px solid #c084fc' } },
          error:   { style: { background: '#fff1f2', color: '#9f1239', border: '1px solid #fda4af' } },
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
