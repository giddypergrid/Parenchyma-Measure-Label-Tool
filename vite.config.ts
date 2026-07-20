import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so built assets resolve from file:// inside the packaged app
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
})
