import { useState } from 'react'
import type { Project } from './types'
import Start from './screens/Start'
import ProjectView from './screens/ProjectView'

export default function App() {
  // window.api is injected by Electron's preload; absent in a plain browser tab
  const desktop = typeof window !== 'undefined' && !!window.api
  const [open, setOpen] = useState<{ dir: string; project: Project } | null>(null)

  if (!desktop) {
    return (
      <div className="app">
        <header className="bar">
          <div className="left">
            <h1>Parenchyma Measure</h1>
          </div>
        </header>
        <main className="wrap">
          <p className="warn">
            Running in a browser tab — file dialogs and ffmpeg only work in the app window. Stop
            this and run <code>npm run dev</code>, then use the window it opens.
          </p>
        </main>
      </div>
    )
  }

  return (
    <>
      {open ? (
        <ProjectView dir={open.dir} project={open.project} onClose={() => setOpen(null)} />
      ) : (
        <Start onOpen={setOpen} />
      )}
      <div className="watermark">
        Developed by <b>Ziyuan Sun</b> · sunziyuan000@gmail.com<br />
        For the mammary gland development research of Racheal Bryant<br />
        Lincoln University, New Zealand
      </div>
    </>
  )
}
