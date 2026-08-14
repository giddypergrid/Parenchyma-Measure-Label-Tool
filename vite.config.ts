import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this branch from /docs, so the build goes straight there
  // — no second copy to keep in sync. base './' keeps assets working under the
  // repository sub-path the site is published at.
  base: './',
  build: { outDir: 'docs', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
})
