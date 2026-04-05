// Wordy Service Worker — handles push notifications

self.addEventListener('push', (event) => {
  let data = { title: 'Wordy', body: "It's your turn!" }
  try {
    if (event.data) data = event.data.json()
  } catch {
    // fallback to defaults
  }

  const tag = data.tag || 'wordy-turn'

  const options = {
    body: data.body,
    icon: '/wordy/favicon.svg',
    badge: '/wordy/favicon.svg',
    tag,                                  // collapse duplicate notifications
    renotify: true,                       // vibrate even if tag matches
    data: { url: data.url || '/wordy/lobby' },
  }

  event.waitUntil(
    // Check if user is already looking at the specific game
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Only skip if the user is focused on the SPECIFIC game page this
      // notification is about — not just any Wordy tab (e.g. lobby)
      const targetUrl = data.url || ''
      const hasFocusedClient = windowClients.some(
        c => c.visibilityState === 'visible' && c.focused
             && targetUrl && c.url.includes(targetUrl)
      )
      if (hasFocusedClient) return

      // Using the same `tag` automatically replaces any existing notification
      // for this game, and `renotify: true` re-alerts the user.  No manual
      // duplicate check needed — the old one that was here silently dropped
      // legitimate new notifications when the user hadn't dismissed the old one.
      return self.registration.showNotification(data.title, options)
    })
  )
})

// When the user taps the notification, open/focus the right page
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/wordy/lobby'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a Wordy tab is already open, focus it and tell it to navigate
      for (const client of windowClients) {
        if (client.url.includes('/wordy/') && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            // Use postMessage so the React app can navigate via React Router
            // instead of a full page reload (which breaks on GitHub Pages SPA)
            focusedClient.postMessage({ type: 'NAVIGATE', url: targetUrl })
          })
        }
      }
      // Otherwise open a new tab with the full URL
      return clients.openWindow(targetUrl)
    })
  )
})

// Activate immediately — no offline caching needed, just push
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})
