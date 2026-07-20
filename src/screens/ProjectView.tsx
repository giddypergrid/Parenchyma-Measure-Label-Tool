import { useState } from 'react'
import { newId, type Project, type Timepoint } from '../types'
import type { Capture } from '../types'
import { metrics, quarterOf, scaleOf } from '../measure'
import { rel } from '../paths'
import Timepoints from './Timepoints'
import TimepointView from './TimepointView'
import MeasureView from './MeasureView'

type Props = { dir: string; project: Project; onClose: () => void }

/** Quote anything containing a comma, quote or newline, else Excel splits the row. */
const cell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvText(project: Project) {
  const head = ['calf_id', 'quarter', 'timepoint', 'date', 'diet', 'clip', 'frame',
    'area_mm2', 'width_mm', 'depth_mm', 'scale_px_per_cm'].join(',')
  const byId = Object.fromEntries(project.timepoints.map((t) => [t.id, t]))
  const rows = project.captures.flatMap((c) => {
    const ppc = scaleOf(project, c)          // per-image scale, if it has one
    const m = metrics(c.border, ppc)
    if (!m) return []
    const t = byId[c.timepointId]
    // frame filename is recorded so any measurement can be traced back to its image
    const frame = c.framePath?.split(/[\\/]/).pop() ?? ''
    return [[c.calf, quarterOf(project, c), t?.name ?? '', t?.date ?? '', c.diet, c.clip, frame,
      m.area.toFixed(1), m.width.toFixed(1), m.depth.toFixed(1), ppc]
      .map(cell).join(',')]
  })
  return [head, ...rows].join('\n')
}

export default function ProjectView({ dir, project: initial, onClose }: Props) {
  const [project, setProject] = useState<Project>(initial)
  const [openTp, setOpenTp] = useState<Timepoint | null>(null)
  const [openCapId, setOpenCapId] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [ppc, setPpc] = useState(String(initial.scalePpc))
  const [defQuarter, setDefQuarter] = useState(initial.defaultQuarter ?? '')
  const [flash, setFlash] = useState('')

  function update(next: Project) {
    setProject(next)
    window.api.saveProject({ dir, project: next })
  }

  function addTimepoint(name: string, date: string) {
    update({ ...project, timepoints: [...project.timepoints, { id: newId(), name, date }] })
  }

  function renameTimepoint(id: string, name: string, date: string) {
    update({
      ...project,
      timepoints: project.timepoints.map((t) => (t.id === id ? { ...t, name, date } : t)),
    })
  }

  /** A freshly added clip becomes a capture and opens straight into the split screen. */
  function addCaptureFromVideo(
    clip: string, firstFrame: string, framesDir: string, videoPath: string,
  ) {
    if (!openTp) return
    const id = newId()
    update({
      ...project,
      captures: [...project.captures, {
        id, timepointId: openTp.id, clip,
        calf: clip.match(/\d{3,}/)?.[0] ?? clip, diet: '',
        quarter: clip.toUpperCase().match(/\b(LF|RF|LR|RR)\b/)?.[1] ?? '',
        // stored relative so the project folder stays portable
        framesDir: rel(dir, framesDir), videoPath: rel(dir, videoPath),
        framePath: rel(dir, firstFrame), border: null,
      }],
    })
    setOpenCapId(id)
  }

  /** Pressing Capture picks the working still — persist it right away. */
  function captureFrame(captureId: string, framePath: string) {
    update({
      ...project,
      captures: project.captures.map((c) =>
        c.id === captureId ? { ...c, framePath, border: null } : c),
    })
  }

  function saveMeasurement(captureId: string, patch: Partial<Capture>) {
    const next: Project = {
      ...project,
      captures: project.captures.map((c) => (c.id === captureId ? { ...c, ...patch } : c)),
    }
    update(next)
    // jump to the next unmeasured capture in this timepoint, else back to the grid
    const todo = next.captures.find(
      (c) => c.timepointId === openTp?.id && c.id !== captureId && !(c.border && c.border.length >= 3),
    )
    setOpenCapId(todo ? todo.id : null)
  }

  async function exportCsv() {
    const filePath = `${dir}\\measurements.csv`
    await window.api.writeFile({ filePath, contents: csvText(project) })
    const n = project.captures.filter((c) => metrics(c.border, project.scalePpc)).length
    setFlash(`Exported ${n} rows → measurements.csv`)
    setTimeout(() => setFlash(''), 4000)
  }

  const capture = openCapId ? project.captures.find((c) => c.id === openCapId) ?? null : null

  return (
    <div className="app">
      <header className="bar">
        <div className="left">
          <h1>{project.name}</h1>
          <span className="sub">{dir}</span>
        </div>
        <div className="right">
          <button onClick={exportCsv}>Export CSV</button>
          <button onClick={() => { setPpc(String(project.scalePpc)); setSettings(true) }}>Settings</button>
          {openTp && !capture && <button onClick={() => setOpenTp(null)}>‹ All timepoints</button>}
          <button onClick={onClose}>‹ Projects</button>
        </div>
      </header>

      <main className="wrap">
        {flash && <p className="flash">{flash}</p>}

        {capture && openTp ? (
          <MeasureView dir={dir} project={project} timepoint={openTp} capture={capture}
            onSave={saveMeasurement} onCaptureFrame={captureFrame}
            onBack={() => setOpenCapId(null)} />
        ) : openTp ? (
          <TimepointView dir={dir} project={project} timepoint={openTp}
            onOpenCapture={(c) => setOpenCapId(c.id)} onVideoAdded={addCaptureFromVideo} />
        ) : (
          <Timepoints project={project} onAdd={addTimepoint} onRename={renameTimepoint}
            onOpen={setOpenTp} />
        )}
      </main>

      {settings && (
        <div className="modal" onClick={() => setSettings(false)}>
          <div className="box" onClick={(e) => e.stopPropagation()}>
            <h2>Project settings</h2>
            <div className="field">
              <label>Scale — pixels per centimetre (from the depth ruler)</label>
              <div className="row">
                <input type="number" step="0.1" value={ppc} onChange={(e) => setPpc(e.target.value)}
                  style={{ width: 110 }} />
                <span className="muted small">= {(10 / (Number(ppc) || 132)).toFixed(4)} mm per pixel</span>
              </div>
            </div>
            <p className="muted small">
              Every area, width and depth is derived from this. Changing it re-scales existing
              measurements, except any image with its own override.
            </p>
            <div className="field">
              <label>Default quarter — the gland scanned throughout this study</label>
              <select value={defQuarter} onChange={(e) => setDefQuarter(e.target.value)} style={{ width: 110 }}>
                <option value="">—</option>
                {['LF', 'RF', 'LR', 'RR'].map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div className="row end">
              <button onClick={() => setSettings(false)}>Cancel</button>
              <button className="pri" onClick={() => {
                update({
                  ...project,
                  scalePpc: Number(ppc) || project.scalePpc,
                  defaultQuarter: defQuarter || undefined,
                })
                setSettings(false)
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
