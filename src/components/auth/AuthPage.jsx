import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from '../../lib/supabase.js'
import { useTheme } from '../../contexts/ThemeContext.jsx'

// Site key is public (safe to commit — it's embedded in the browser bundle anyway).
// The env var override allows using a different key in other environments.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAACrUqndWqt4-0ExK'

// The URL users are redirected to after clicking the email verification link.
// Must match what's configured in Supabase → Authentication → URL Configuration.
const SITE_URL = 'https://katinkabeat.github.io/wordy/'

export default function AuthPage({ isRecovery = false, onPasswordReset = () => {} }) {
  const { isDark } = useTheme()
  const [mode, setMode]               = useState('login')   // 'login' | 'register' | 'forgot'
  const [email, setEmail]             = useState('')
  const [password, setPass]           = useState('')
  const [confirm, setConfirm]         = useState('')
  const [username, setUser]           = useState('')
  const [loading, setLoading]         = useState(false)
  const [captchaToken, setCaptchaToken] = useState(null)
  const [registered, setRegistered]   = useState(false)   // show email confirmation screen
  const [resetSent, setResetSent]     = useState(false)   // show forgot-password confirmation screen
  const [showPass, setShowPass]       = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [newPass, setNewPass]         = useState('')
  const [newConfirm, setNewConfirm]   = useState('')
  const [showNewPass, setShowNewPass]     = useState(false)
  const [showNewConfirm, setShowNewConfirm] = useState(false)
  const turnstileRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()

    // Block submission until CAPTCHA is solved (all modes)
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error('Please complete the CAPTCHA check first.')
      return
    }

    setLoading(true)

    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          // Use the root URL so GitHub Pages serves index.html directly
          // (avoids the 404-redirect that would strip the #type=recovery hash)
          redirectTo: SITE_URL,
          ...(captchaToken ? { captchaToken } : {}),
        })
        if (error) throw error
        setResetSent(true)
        return
      }

      if (mode === 'register') {
        if (username.length < 3) {
          toast.error('Username must be at least 3 characters.')
          return
        }
        if (password !== confirm) {
          toast.error('Passwords do not match.')
          return
        }
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            data: { username },
            // Fix: tells Supabase where to send users after they click the
            // verification link — must be the live site, not localhost.
            emailRedirectTo: SITE_URL,
            ...(captchaToken ? { captchaToken } : {}),
          },
        })
        if (error) throw error
        setRegistered(true)
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email, password,
          options: captchaToken ? { captchaToken } : {},
        })
        if (error) throw error
        toast.success('Welcome back! 🟣')
      }
    } catch (err) {
      toast.error(err.message ?? 'Something went wrong.')
      // Always reset the CAPTCHA after an error so the user can try again
      resetCaptcha()
    } finally {
      setLoading(false)
    }
  }

  function resetCaptcha() {
    setCaptchaToken(null)
    turnstileRef.current?.reset()
  }

  function switchMode(newMode) {
    setMode(newMode)
    setConfirm('')
    setResetSent(false)
    setShowPass(false)
    setShowConfirm(false)
    // Preserve the CAPTCHA token when switching TO forgot mode —
    // the token from the login form is still valid and can be used
    // for the password reset request immediately, without waiting
    // for the widget to re-solve.
    if (newMode !== 'forgot') {
      resetCaptcha()
    }
  }

  // ── Set new password screen (arrived via reset email link) ──
  if (isRecovery) {
    async function handleNewPassword(e) {
      e.preventDefault()
      if (newPass !== newConfirm) { toast.error('Passwords do not match.'); return }
      setLoading(true)
      try {
        const { error } = await supabase.auth.updateUser({ password: newPass })
        if (error) throw error
        toast.success('Password updated! Please log in. 🟣')
        onPasswordReset()
      } catch (err) {
        toast.error(err.message ?? 'Something went wrong.')
      } finally {
        setLoading(false)
      }
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-200 dark:bg-[#0f0a1e] dark:bg-none p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-wordy-600 shadow-lg mb-3">
              <span className="font-display text-4xl text-white tracking-tight">W</span>
            </div>
            <h1 className="font-display text-4xl text-wordy-800 dark:text-wordy-200">Wordy</h1>
          </div>
          <div className="card shadow-lg">
            <h2 className="font-display text-xl text-wordy-800 mb-5 text-center dark:text-wordy-200">🔑 Set a new password</h2>
            <form onSubmit={handleNewPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-wordy-700 mb-1">New password</label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'} value={newPass} onChange={e => setNewPass(e.target.value)}
                    placeholder="••••••••" required minLength={6}
                    className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 pr-10 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
                  />
                  <button type="button" onClick={() => setShowNewPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-base">
                    {showNewPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-wordy-700 mb-1">Confirm new password</label>
                <div className="relative">
                  <input
                    type={showNewConfirm ? 'text' : 'password'} value={newConfirm} onChange={e => setNewConfirm(e.target.value)}
                    placeholder="••••••••" required
                    className={`w-full border-2 rounded-xl px-3 py-2 pr-10 text-sm font-body outline-none bg-wordy-50 ${
                      newConfirm && newConfirm !== newPass
                        ? 'border-rose-400 focus:border-rose-500'
                        : 'border-wordy-200 focus:border-wordy-400'
                    }`}
                  />
                  <button type="button" onClick={() => setShowNewConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-base">
                    {showNewConfirm ? '🙈' : '👁️'}
                  </button>
                </div>
                {newConfirm && newConfirm !== newPass && (
                  <p className="text-xs text-rose-500 mt-1">Passwords don't match.</p>
                )}
              </div>
              <button type="submit" disabled={loading}
                className="btn-primary w-full py-3 text-base disabled:opacity-60">
                {loading ? '⏳ Please wait…' : '🔑 Update password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // ── Forgot-password confirmation screen ──────────────────
  if (resetSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-200 dark:bg-[#0f0a1e] dark:bg-none p-4">
        <div className="w-full max-w-sm">
          <div className="card shadow-lg text-center space-y-4">
            <div className="text-5xl">📧</div>
            <h2 className="font-display text-2xl text-wordy-800">Check your email!</h2>
            <p className="text-sm text-wordy-600 font-body">
              We sent a password reset link to <span className="font-bold text-wordy-700">{email}</span>.
            </p>
            <p className="text-sm text-wordy-500 font-body">
              Click the link in that email to choose a new password.
            </p>
            <p className="text-xs text-wordy-400 font-body">
              Can't find it? Check your spam folder.
            </p>
            <button onClick={() => switchMode('login')} className="btn-primary w-full py-3 text-base">
              🔓 Back to log in
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Email confirmation screen ────────────────────────────
  if (registered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-200 dark:bg-[#0f0a1e] dark:bg-none p-4">
        <div className="w-full max-w-sm">
          <div className="card shadow-lg text-center space-y-4">
            <div className="text-5xl">📧</div>
            <h2 className="font-display text-2xl text-wordy-800">Check your email!</h2>
            <p className="text-sm text-wordy-600 font-body">
              We sent a confirmation link to <span className="font-bold text-wordy-700">{email}</span>.
            </p>
            <p className="text-sm text-wordy-500 font-body">
              Click the link in that email to activate your account, then come back here to log in.
            </p>
            <p className="text-xs text-wordy-400 font-body">
              Can't find it? Check your spam folder.
            </p>
            <button
              onClick={() => { setRegistered(false); setMode('login') }}
              className="btn-primary w-full py-3 text-base"
            >
              🔓 Go to log in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-wordy-100 via-pink-100 to-wordy-200 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-wordy-600 shadow-lg mb-3">
            <span className="font-display text-4xl text-white tracking-tight">W</span>
          </div>
          <h1 className="font-display text-4xl text-wordy-800 dark:text-wordy-200">Wordy</h1>
          <p className="text-wordy-500 font-body mt-1 text-sm dark:text-wordy-400">
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
                onClick={() => switchMode(m)}
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
            {/* Forgot password — email only */}
            {mode === 'forgot' && (
              <>
                <p className="text-sm text-wordy-500 text-center font-body">
                  Enter your email and we'll send you a reset link.
                </p>
                <div>
                  <label className="block text-xs font-bold text-wordy-700 mb-1">Email</label>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                    className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
                  />
                </div>
              </>
            )}

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
            {mode !== 'forgot' && (
            <div>
              <label className="block text-xs font-bold text-wordy-700 mb-1">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
              />
            </div>
            )}
            {mode !== 'forgot' && (
            <div>
              <label className="block text-xs font-bold text-wordy-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'} value={password} onChange={e => setPass(e.target.value)}
                  placeholder="••••••••"
                  required minLength={6}
                  className="w-full border-2 border-wordy-200 rounded-xl px-3 py-2 pr-10 text-sm font-body outline-none focus:border-wordy-400 bg-wordy-50"
                />
                <button
                  type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-base"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            )}

            {/* Forgot password link — login tab only */}
            {mode === 'login' && (
              <div className="text-right -mt-2">
                <button type="button" onClick={() => switchMode('forgot')}
                  className="text-xs text-wordy-500 hover:text-wordy-700 underline">
                  Forgot password?
                </button>
              </div>
            )}

            {/* Confirm password — sign-up only */}
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-wordy-700 mb-1">Confirm password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    className={`w-full border-2 rounded-xl px-3 py-2 pr-10 text-sm font-body outline-none bg-wordy-50 ${
                      confirm && confirm !== password
                        ? 'border-rose-400 focus:border-rose-500'
                        : 'border-wordy-200 focus:border-wordy-400'
                    }`}
                  />
                  <button
                    type="button" onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-wordy-400 hover:text-wordy-700 text-base"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? '🙈' : '👁️'}
                  </button>
                </div>
                {confirm && confirm !== password && (
                  <p className="text-xs text-rose-500 mt-1">Passwords don't match.</p>
                )}
              </div>
            )}

            {/* Cloudflare Turnstile CAPTCHA — required for all modes including password reset */}
            {TURNSTILE_SITE_KEY && (
              <div className="flex justify-center">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={token => setCaptchaToken(token)}
                  onExpire={resetCaptcha}
                  onError={resetCaptcha}
                  options={{ theme: isDark ? 'dark' : 'light' }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (TURNSTILE_SITE_KEY && !captchaToken)}
              className="btn-primary w-full py-3 text-base disabled:opacity-60"
            >
              {loading
                ? '⏳ Please wait…'
                : mode === 'login'   ? '🔓 Log in'
                : mode === 'forgot'  ? '📧 Send reset link'
                : '✨ Create account'}
            </button>

            {/* Back to login link when in forgot mode */}
            {mode === 'forgot' && (
              <p className="text-center text-xs text-wordy-400">
                <button type="button" onClick={() => switchMode('login')}
                  className="text-wordy-600 font-bold underline">
                  ← Back to log in
                </button>
              </p>
            )}
          </form>
        </div>

        <p className="text-center text-xs text-wordy-400 mt-4">
          {mode === 'login'
            ? "Don't have an account? "
            : 'Already have an account? '}
          <button
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            className="text-wordy-600 font-bold underline"
          >
            {mode === 'login' ? 'Sign up!' : 'Log in!'}
          </button>
        </p>
      </div>
    </div>
  )
}
