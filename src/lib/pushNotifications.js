import { supabase } from './supabase.js'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

/**
 * Check if push notifications are supported and permission state.
 * Returns: 'unsupported' | 'granted' | 'denied' | 'default'
 */
export function getPushPermissionState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported'
  }
  return Notification.permission  // 'granted' | 'denied' | 'default'
}

/**
 * Register the service worker (idempotent — safe to call multiple times).
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/wordy/sw.js')
}

/**
 * Subscribe to push notifications and save the subscription to Supabase.
 * Returns true on success, false on failure.
 */
export async function subscribeToPush(userId) {
  try {
    const registration = await registerServiceWorker()
    if (!registration) return false

    // Wait for the service worker to be ready
    const sw = await navigator.serviceWorker.ready

    // Check for an existing subscription first
    let subscription = await sw.pushManager.getSubscription()

    if (!subscription) {
      // Convert VAPID key from base64url to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      subscription = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }

    // Save to Supabase
    const subJson = subscription.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: subJson.endpoint,
      keys_p256dh: subJson.keys.p256dh,
      keys_auth: subJson.keys.auth,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })

    if (error) {
      console.error('Failed to save push subscription:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('Push subscription failed:', err)
    return false
  }
}

/**
 * Unsubscribe from push and remove from Supabase.
 */
export async function unsubscribeFromPush(userId) {
  try {
    const sw = await navigator.serviceWorker.ready
    const subscription = await sw.pushManager.getSubscription()
    if (subscription) await subscription.unsubscribe()

    await supabase.from('push_subscriptions').delete().eq('user_id', userId)
    return true
  } catch (err) {
    console.error('Push unsubscribe failed:', err)
    return false
  }
}

/**
 * Check if the current user has an active push subscription.
 */
export async function hasActivePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const sw = await navigator.serviceWorker.ready
    const subscription = await sw.pushManager.getSubscription()
    return !!subscription
  } catch {
    return false
  }
}

// ── Utility ────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
