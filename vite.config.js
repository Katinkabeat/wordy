import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Update 'base' to match your GitHub repository name
// e.g. if your repo is github.com/yourname/wordy, set base: '/wordy/'
export default defineConfig({
  plugins: [react()],
  base: '/wordy/',
  server: {
    port: 5181,
    strictPort: true,
  },
})
