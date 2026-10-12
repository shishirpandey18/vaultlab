import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Where the API runs: the Express API on the Dell (Day 8)
const API_URL = process.env.VAULTLAB_API || 'http://vaultlab.home:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    // Any request to /api/... is passed on to the API server.
    // The browser only ever talks to Vite, so there is no CORS problem.
    proxy: {
      '/api': API_URL,
    },
  },
})
