import { useState } from 'react'
import { newId, type Project, type Timepoint } from '../types'
import type { Capture } from '../types'
import { metrics, quarterOf, scaleOf } from '../measure'
import { rel, timepointDir, uniqueTimepointDir } from '../paths'
import Timepoints from './Timepoints'
import TimepointView, { type ImportEntry } from './TimepointView'
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
      // 3 dp in the export so no precision is lost before analysis
      m.area.toFixed(3), m.width.toFixed(3), m.depth.toFixed(3), ppc]
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
  const [saveErr, setSaveErr] = useState('')

  /**
   * Every change is written to project.json immediately. A failed write used to
   * be silent, which meant work could look saved and be gone on reload — the
   * banner stays up until a write succeeds.
   */
  function update(next: Project) {
    setProject(next)
    window.api
      .saveProject({ dir, project: next })
      .then(() => setSaveErr(''))
      .catch((e: Error) =>
        setSaveErr(`Could not save to project.json — your last change is NOT on disk. ${e.message}`))
  }

  function addTimepoint(name: string, date: string) {
    const dir = uniqueTimepointDir(name, project.timepoints)
    update({ ...project, timepoints: [...project.timepoints, { id: newId(), name, date, dir }] })
  }

  function renameTimepoint(id: string, name: string, date: string) {
    update({
      ...project,
      timepoints: project.timepoints.map((t) => (t.id === id ? { ...t, name, date } : t)),
    })
  }

  /**
   * Images and clips arrive as one confirmed batch. Identity comes from what the
   * operator approved at import, never from the filename. A single file opens
   * straight into measuring; a batch leaves you on the grid to pick from.
   */
  function addCaptures(entries: ImportEntry[]) {
    if (!openTp || !entries.length) return
    const added: Capture[] = entries.map((e) => ({
      id: newId(), timepointId: openTp.id, clip: e.clip, calf: e.calf.trim(), diet: e.diet,
      quarter: e.quarter && e.quarter !== project.defaultQuarter ? e.quarter : undefined,
      source: e.videoPath ? 'video' : 'image',
      // stored relative so the project folder stays portable
      framesDir: rel(dir, e.framesDir), framePath: rel(dir, e.framePath),
      videoPath: e.videoPath ? rel(dir, e.videoPath) : undefined,
      border: null,
    }))
    update({ ...project, captures: [...project.captures, ...added] })
    if (added.length === 1) setOpenCapId(added[0].id)
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
    // Only a finished outline advances. Correcting a calf id on an unmeasured
    // capture should leave you where you are, not skip you to another animal.
    if (!patch.border) return
    const todo = next.captures.find(
      (c) => c.timepointId === openTp?.id && c.id !== captureId && !(c.border && c.border.length >= 3),
    )
    setOpenCapId(todo ? todo.id : null)
  }

  /** Removes the capture, its video, its stills and its outline. */
  async function deleteCapture(id: string) {
    const c = project.captures.find((x) => x.id === id)
    if (!c) return
    const measured = c.border && c.border.length >= 3
    const what = c.source === 'image' ? 'the image' : 'the video and its stills'
    if (!confirm(
      `Delete calf ${c.calf} — ${c.clip}?\n\n` +
      `This removes ${what}${measured ? ' and the saved outline' : ''} ` +
      `from disk.\n\nThis cannot be undone.`)) return
    if (c.framesDir) {
      try { await window.api.deleteFolder({ projectDir: dir, target: c.framesDir }) }
      catch (e) { alert('Could not delete the files: ' + (e as Error).message) }
    }
    update({ ...project, captures: project.captures.filter((x) => x.id !== id) })
    if (openCapId === id) setOpenCapId(null)
  }

  /** Removes the timepoint and every capture inside it, files included. */
  async function deleteTimepoint(id: string) {
    const t = project.timepoints.find((x) => x.id === id)
    if (!t) return
    const caps = project.captures.filter((c) => c.timepointId === id)
    const measured = caps.filter((c) => c.border && c.border.length >= 3).length
    if (!confirm(
      `Delete ${t.name}?\n\n` +
      `${caps.length} capture(s), including ${measured} saved measurement(s), and all ` +
      `their videos and stills will be removed from disk.\n\nThis cannot be undone.`)) return
    for (const c of caps) {
      if (!c.framesDir) continue
      try { await window.api.deleteFolder({ projectDir: dir, target: c.framesDir }) } catch { /* keep going */ }
    }
    // the folder is addressed by its stored dir, so a rename cannot misdirect this
    try { await window.api.deleteFolder({ projectDir: dir, target: timepointDir(t) }) } catch { /* may already be gone */ }
    update({
      ...project,
      timepoints: project.timepoints.filter((x) => x.id !== id),
      captures: project.captures.filter((c) => c.timepointId !== id),
    })
    if (openTp?.id === id) setOpenTp(null)
    setOpenCapId(null)
  }

  async function exportCsv() {
    const n = project.captures.filter((c) => metrics(c.border, scaleOf(project, c))).length
    if (!n) {
      setFlash('Nothing to export yet — no capture has a saved outline.')
      setTimeout(() => setFlash(''), 4000)
      return
    }
    try {
      await window.api.writeFile({ filePath: `${dir}\\measurements.csv`, contents: csvText(project) })
      setFlash(`Exported ${n} row${n > 1 ? 's' : ''} → measurements.csv`)
      setTimeout(() => setFlash(''), 4000)
    } catch (e) {
      setSaveErr('Export failed: ' + (e as Error).message)
    }
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
        {saveErr && <p className="warn">{saveErr}</p>}
        {flash && <p className="flash">{flash}</p>}

        {capture && openTp ? (
          <MeasureView dir={dir} project={project} timepoint={openTp} capture={capture}
            onSave={saveMeasurement} onCaptureFrame={captureFrame}
            onSetProjectScale={(v) => update({ ...project, scalePpc: v })}
            onBack={() => setOpenCapId(null)} />
        ) : openTp ? (
          <TimepointView dir={dir} project={project} timepoint={openTp}
            onOpenCapture={(c) => setOpenCapId(c.id)} onImported={addCaptures}
            onDeleteCapture={deleteCapture} />
        ) : (
          <Timepoints project={project} onAdd={addTimepoint} onRename={renameTimepoint}
            onOpen={setOpenTp} onDelete={deleteTimepoint} />
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
