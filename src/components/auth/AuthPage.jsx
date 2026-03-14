import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase.js'

export default function AuthPage() {
  const [mode, setMode]       = useState('login')   // 'login' | 'register'
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [username, setUser]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)

    try {
      if (mode === 'register') {
        if (username.length < 3) {
          toast.error('Username must be at least 3 characters.')
          return
        }
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { username } },
        })
        if (error) throw error
        toast.success('✨ Account created! Check your email to confirm.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        toast.success('Welcome back! 🟣')
      }
    } catch (err) {
      toast.error(err.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-200 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-wordy-600 shadow-lg mb-3">
            <span className="font-display text-4xl text-white tracking-tight">W</span>
          </div>
          <h1 className="font-display text-4xl text-wordy-800">Wordy</h1>
          <p className="text-wordy-500 font-body mt-1 text-sm">
            🌸 The cute word game for friends
          </p>
        </div>

        {/* Card */}
        <div className="card shadow-lg">
          {/* Tab switcher */}
          <div className="flex rounded-xl bg-wordy-50 p-1 mb-5 border border-wordy-100">
            {['login', 'register'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                  mode === m
                    ? 'bg-wordy-600 text-white shadow'
                    : 'text-wordy-500 hover:text-wordy-700'
                }`}
              >
                {m === 'login' ? '🔓 Log in' : '✨ Sign up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-wordy-700 mb-1">Username</label>
                <input
                  type="text" value={username} onChange={e => setUser(e.target.value)}
                  placeholder="e.g. wordwitch_rae"
                  required minLength={3} maxLength={20}
                  className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-wordy-700 mb-1">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-wordy-700 mb-1">Password</label>
              <input
                type="password" value={password} onChange={e => setPass(e.target.value)}
                placeholder="••••••••"
                required minLength={6}
                className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
              />
            </div>

            <button
              type="submit" disabled={loading}
              className="btn-primary w-full py-3 text-base disabled:opacity-60"
            >
              {loading
                ? '⏳ Please wait…'
                : mode === 'login' ? '🔓 Log in' : '✨ Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-wordy-400 mt-4">
          {mode === 'login'
            ? "Don't have an account? "
            : 'Already have an account? '}
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-wordy-600 font-bold underline"
          >
            {mode === 'login' ? 'Sign up!' : 'Log in!'}
          </button>
        </p>
      </div>
    </div>
  )
}
