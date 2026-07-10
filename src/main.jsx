import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { SQErrorBoundary, installGlobalErrorReporting } from '../../rae-side-quest/packages/sq-ui/index.js'
import './index.css'

// Report uncaught errors + unhandled rejections + render crashes to #error-log (c266).
installGlobalErrorReporting({
  game: 'wordy',
  reportUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sq-report-client-error`,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})

// Register service worker for push notifications + PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/wordy/sw.js').catch(() => {
      // SW registration failed — push won't work but game still loads fine
    })
  })

  // Listen for navigation messages from the service worker.
  // When a push notification is tapped, the SW sends { type: 'NAVIGATE', url }
  // so we can route to the game without a full page reload.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NAVIGATE' && event.data.url) {
      window.location.href = event.data.url
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SQErrorBoundary label="wordy">
      <BrowserRouter basename="/wordy">
        <App />
      </BrowserRouter>
    </SQErrorBoundary>
  </React.StrictMode>,
)
