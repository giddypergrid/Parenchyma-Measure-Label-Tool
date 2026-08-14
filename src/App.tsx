import { useState } from 'react'
import type { Project } from './types'
import Start from './screens/Start'
import ProjectView from './screens/ProjectView'

export default function App() {
  const [open, setOpen] = useState<{ dir: string; project: Project } | null>(null)

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
