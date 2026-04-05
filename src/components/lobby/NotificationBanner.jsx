import { useState, useEffect } from 'react'
import {
  getPushPermissionState,
  subscribeToPush,
  unsubscribeFromPush,
  hasActivePushSubscription,
  resyncPushSubscription,
  registerServiceWorker,
} from '../../lib/pushNotifications.js'

/**
 * A small banner shown in the lobby to let the user enable/disable
 * push notifications. Collapses gracefully if the browser doesn't
 * support push or if the user has already denied permission.
 */
export default function NotificationBanner({ userId }) {
  const [permState, setPermState] = useState(() => getPushPermissionState())
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [dismissed, setDismissed]   = useState(
    () => localStorage.getItem('wordy-push-dismissed') === 'true'
  )

  // Check if already subscribed on mount, and re-sync the subscription
  // to Supabase so the server always has the current push endpoint
  // (endpoints can silently change after browser updates, PWA reinstall, etc.)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Register SW early so it's ready when needed
      await registerServiceWorker()
      const active = await hasActivePushSubscription()
      if (!cancelled) {
        setSubscribed(active)
        setLoading(false)
      }
      // Re-sync subscription to Supabase on every lobby visit
      if (active && userId) {
        await resyncPushSubscription(userId)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  async function handleEnable() {
    setLoading(true)
    const ok = await subscribeToPush(userId)
    if (ok) {
      setSubscribed(true)
      setPermState('granted')
    } else {
      // Permission might have been denied in the browser prompt
      setPermState(getPushPermissionState())
    }
    setLoading(false)
  }

  async function handleDisable() {
    setLoading(true)
    await unsubscribeFromPush(userId)
    setSubscribed(false)
    setLoading(false)
  }

  function handleDismiss() {
    localStorage.setItem('wordy-push-dismissed', 'true')
    setDismissed(true)
  }

  // Don't show if: unsupported, denied, loading, or user dismissed
  if (permState === 'unsupported') return null
  if (permState === 'denied') return null
  if (loading) return null

  // Already subscribed — show a small toggle to disable
  if (subscribed) {
    return (
      <div className="card flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔔</span>
          <span className="text-sm font-bold text-wordy-600 dark:text-wordy-300">
            Turn notifications are on
          </span>
        </div>
        <button
          onClick={handleDisable}
          className="text-xs text-wordy-400 hover:text-wordy-600 underline dark:text-wordy-500 dark:hover:text-wordy-300"
        >
          Turn off
        </button>
      </div>
    )
  }

  // Not subscribed and not dismissed — prompt to enable
  if (!dismissed) {
    return (
      <div className="card border-2 border-wordy-200 dark:border-[#3d2070]">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">🔔</span>
          <div className="flex-1">
            <p className="font-bold text-wordy-700 dark:text-wordy-300 text-sm">
              Never miss your turn!
            </p>
            <p className="text-xs text-wordy-400 dark:text-wordy-500 mt-0.5">
              Get a notification on your phone or laptop when it's your turn to play.
            </p>
            <div className="flex gap-2 mt-2">
              <button onClick={handleEnable} className="btn-primary text-xs py-1.5 px-3">
                Enable Notifications
              </button>
              <button
                onClick={handleDismiss}
                className="text-xs text-wordy-400 hover:text-wordy-600 dark:text-wordy-500 dark:hover:text-wordy-300"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Dismissed — show a tiny "enable" link
  return (
    <div className="text-center">
      <button
        onClick={handleEnable}
        className="text-xs text-wordy-400 hover:text-wordy-600 underline dark:text-wordy-500 dark:hover:text-wordy-300"
      >
        🔔 Enable turn notifications
      </button>
    </div>
  )
}
