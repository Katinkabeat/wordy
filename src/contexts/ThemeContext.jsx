import { createContext, useContext, useEffect, useState } from 'react'

// Shared across all SideQuest apps (same origin = shared localStorage).
// Toggling theme in one game updates all of them.
const STORAGE_KEY = 'sq-theme'
const LEGACY_KEYS = ['wordy-theme', 'rungles-theme', 'snibble-theme']

function readInitial() {
  let v = localStorage.getItem(STORAGE_KEY)
  if (v == null) {
    for (const k of LEGACY_KEYS) {
      const lv = localStorage.getItem(k)
      if (lv != null) { v = lv; break }
    }
  }
  return v === 'dark'
}

const ThemeContext = createContext({ isDark: false, toggle: () => {} })

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(readInitial)

  useEffect(() => {
    const html = document.documentElement
    if (isDark) html.classList.add('dark')
    else html.classList.remove('dark')
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setIsDark(e.newValue === 'dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <ThemeContext.Provider value={{ isDark, toggle: () => setIsDark(d => !d) }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
