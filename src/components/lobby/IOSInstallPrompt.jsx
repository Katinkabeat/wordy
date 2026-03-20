import { useState } from 'react'

/**
 * Detects iOS Safari users who haven't installed the PWA to their
 * Home Screen yet, and walks them through the install steps.
 *
 * Why this matters:
 * iOS only supports Web Push notifications for PWAs running in
 * "standalone" mode (i.e. added to Home Screen). Without this,
 * iOS users will never see the notification banner because
 * PushManager isn't available in regular Safari.
 *
 * Detection logic:
 * 1. Is the device iOS? (iPhone / iPad / iPod)
 * 2. Is the browser Safari? (not Chrome/Firefox/etc. on iOS —
 *    only Safari supports "Add to Home Screen" PWA install)
 * 3. Is the app already running standalone? If yes, no prompt needed.
 */

// ── Detection helpers ──────────────────────────────────────────

function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Standard iOS detection
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPad on iOS 13+ reports as Mac with touch support
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

function isInStandaloneMode() {
  // Check the display-mode media query (works cross-browser)
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // Apple-specific fallback
  if (navigator.standalone === true) return true
  return false
}

function isSafariBrowser() {
  const ua = navigator.userAgent
  // Safari includes "Safari" but NOT "CriOS" (Chrome), "FxiOS" (Firefox),
  // "EdgiOS" (Edge), or "OPiOS" (Opera) in its user-agent string
  const isSafari = /Safari/.test(ua)
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)
  return isSafari && !isOtherBrowser
}

// ── Component ──────────────────────────────────────────────────

const DISMISS_KEY = 'wordy-ios-install-dismissed'

export default function IOSInstallPrompt() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === 'true'
  )
  const [showSteps, setShowSteps] = useState(false)

  // Don't render if: not iOS, already installed, not Safari, or dismissed
  if (!isIOS() || isInStandaloneMode() || dismissed) return null

  const isSafari = isSafariBrowser()

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  // Non-Safari iOS browser — tell user to open in Safari first
  if (!isSafari) {
    return (
      <div className="card border-2 border-amber-200 dark:border-amber-800/50">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">📲</span>
          <div className="flex-1">
            <p className="font-bold text-wordy-700 dark:text-wordy-300 text-sm">
              Want notifications on your iPhone?
            </p>
            <p className="text-xs text-wordy-400 dark:text-wordy-500 mt-0.5">
              Open Wordy in <strong>Safari</strong> to install it to your Home Screen.
              Push notifications only work from the Home Screen app.
            </p>
            <button
              onClick={handleDismiss}
              className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300 mt-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Safari on iOS — guide through Add to Home Screen
  return (
    <div className="card border-2 border-wordy-200 dark:border-[#3d2070]">
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5">📲</span>
        <div className="flex-1">
          <p className="font-bold text-wordy-700 dark:text-wordy-300 text-sm">
            Install Wordy for notifications!
          </p>
          <p className="text-xs text-wordy-400 dark:text-wordy-500 mt-0.5">
            Add Wordy to your Home Screen to get push notifications
            when it's your turn. It only takes a few seconds.
          </p>

          {!showSteps ? (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setShowSteps(true)}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Show Me How
              </button>
              <button
                onClick={handleDismiss}
                className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
              >
                Not now
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              <Step number={1}>
                Tap the <strong>Share</strong> button{' '}
                <span className="inline-block bg-wordy-100 dark:bg-[#2d1b55] text-wordy-600 dark:text-wordy-300 text-xs font-mono px-1.5 py-0.5 rounded">
                  ⬆
                </span>{' '}
                at the bottom of Safari
              </Step>
              <Step number={2}>
                Scroll down and tap{' '}
                <strong>"Add to Home Screen"</strong>
              </Step>
              <Step number={3}>
                Tap <strong>"Add"</strong> in the top-right corner
              </Step>
              <Step number={4}>
                Open Wordy from your Home Screen and enable notifications!
              </Step>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowSteps(false)}
                  className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
                >
                  Hide steps
                </button>
                <span className="text-wordy-200 dark:text-wordy-700">·</span>
                <button
                  onClick={handleDismiss}
                  className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
                >
                  Don't show again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step sub-component ─────────────────────────────────────────

function Step({ number, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-wordy-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {number}
      </span>
      <p className="text-xs text-wordy-600 dark:text-wordy-400 leading-relaxed">
        {children}
      </p>
    </div>
  )
}
