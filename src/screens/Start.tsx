import { useEffect, useState } from 'react'
import type { Project, ProjectRef } from '../types'

type Opened = { dir: string; project: Project }
type Props = { onOpen: (o: Opened) => void }

export default function Start({ onOpen }: Props) {
  const [recents, setRecents] = useState<ProjectRef[]>([])
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    window.api.listProjects().then(setRecents)
  }, [])

  function handle(result: Awaited<ReturnType<typeof window.api.openProject>>) {
    if (!result) return
    if ('error' in result) return setErr(result.error)
    onOpen(result)
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="left">
          <h1>Parenchyma Measure</h1>
          <span className="tag">prototype</span>
        </div>
      </header>

      <main className="wrap start">
        <section className="card">
          <h2>Your projects</h2>
          {recents.length === 0 ? (
            <p className="muted">No projects yet — create one below.</p>
          ) : (
            <ul className="plist">
              {recents.map((r) => (
                <li key={r.dir}>
                  <button className="prow" onClick={async () => handle(await window.api.openProject(r.dir))}>
                    <span className="pname">{r.name}</span>
                    <span className="ppath">{r.dir}</span>
                    <span className="pdate">{new Date(r.lastOpened).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={async () => handle(await window.api.openProject())}>
            Open a project folder…
          </button>
        </section>

        <section className="card">
          <h2>New project</h2>
          <div className="row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="project name, e.g. Heifers 2026"
            />
            <button
              className="pri"
              disabled={!name.trim()}
              onClick={async () => handle(await window.api.createProject(name.trim()))}
            >
              Create…
            </button>
          </div>
          <p className="muted small">You choose where the folder goes.</p>
        </section>

        {err && <p className="warn">{err}</p>}
      </main>
    </div>
  )
}
