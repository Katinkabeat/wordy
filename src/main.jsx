import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

// Register service worker for push notifications + PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/wordy/sw.js').catch(() => {
      // SW registration failed — push won't work but game still loads fine
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/wordy">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
