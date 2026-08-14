import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installWebApi } from './webapi'

// storage layer: the screens reach files through window.api, backed by the
// File System Access API against a folder the user picks
installWebApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
