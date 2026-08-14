import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installWebApi } from './webapi'

// Electron injects window.api from its preload; a browser tab gets the web build instead
if (!window.api) installWebApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
