import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { SQErrorBoundary, installGlobalErrorReporting, installPushHeal, installNotificationNav } from '../../rae-side-quest/packages/sq-ui/index.js'
import './index.css'

// Report uncaught errors + unhandled rejections + render crashes to #error-log (c266).
installGlobalErrorReporting({
  game: 'wordy',
  reportUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sq-report-client-error`,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})

// Refresh the shared `sidequest` push address while the user plays (c270, A1).
// No-op unless notification permission is already granted; never prompts.
installPushHeal()

// Let a notification tap steer this already-open app to the tapped board/game.
// The hub SW posts a NAVIGATE message; this performs the hop (c272 games have
// no SW of their own, but still receive a message the SW posts to this window).
installNotificationNav()

// No service worker here (c272). Push is centralized at the hub, whose SW owns
// the single `sidequest` subscription; a game SW would never receive a push.
// Games are intentionally NOT installable PWAs — the hub is the only installable
// SideQuest app. installPushHeal() above keeps the shared address fresh via a
// hub-scoped iframe, so nothing here depends on a game service worker.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SQErrorBoundary label="wordy">
      <BrowserRouter basename="/wordy">
        <App />
      </BrowserRouter>
    </SQErrorBoundary>
  </React.StrictMode>,
)
