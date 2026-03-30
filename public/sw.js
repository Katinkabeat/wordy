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
    Promise.all([
      // Check if user is already looking at the app
      clients.matchAll({ type: 'window', includeUncontrolled: true }),
      // Check if a notification with this tag already exists (prevents
      // duplicates when Android shows both Chrome and PWA channels)
      self.registration.getNotifications({ tag }),
    ]).then(([windowClients, existing]) => {
      // Skip if the user is already focused on Wordy
      const hasFocusedClient = windowClients.some(
        c => c.url.includes('/wordy/') && c.visibilityState === 'visible' && c.focused
      )
      if (hasFocusedClient) return

      // Skip if a notification with this tag is already showing
      if (existing.length > 0) return

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
