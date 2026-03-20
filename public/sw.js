// Wordy Service Worker — handles push notifications

self.addEventListener('push', (event) => {
  let data = { title: 'Wordy', body: "It's your turn!" }
  try {
    if (event.data) data = event.data.json()
  } catch {
    // fallback to defaults
  }

  const options = {
    body: data.body,
    icon: '/wordy/favicon.svg',
    badge: '/wordy/favicon.svg',
    tag: data.tag || 'wordy-turn',       // collapse duplicate notifications
    renotify: true,                       // vibrate even if tag matches
    data: { url: data.url || '/wordy/lobby' },
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

// When the user taps the notification, open/focus the right page
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/wordy/lobby'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a Wordy tab is already open, focus it and navigate
      for (const client of windowClients) {
        if (client.url.includes('/wordy/') && 'focus' in client) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      // Otherwise open a new tab
      return clients.openWindow(targetUrl)
    })
  )
})

// Activate immediately — no offline caching needed, just push
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
