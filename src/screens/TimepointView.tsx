import { useEffect, useState } from 'react'
import type { Capture, Project, Timepoint } from '../types'
import { metrics, quarterOf, scaleOf } from '../measure'
import { abs, safeName } from '../paths'

const FPS = 5 // stills per second of video

type Props = {
  dir: string
  project: Project
  timepoint: Timepoint
  onOpenCapture: (c: Capture) => void
  onVideoAdded: (
    clip: string, firstFrame: string, framesDir: string, videoPath: string,
    calf: string, diet: string, quarter: string,
  ) => void
  onDeleteCapture: (id: string) => void
}

const DIETS = ['HC', 'LC']
const QUARTERS = ['LF', 'RF', 'LR', 'RR']

/**
 * Suggest a calf id from the filename — only ever a suggestion the operator
 * confirms. Takes the first 3-5 digit run so an 8-digit date is skipped.
 */
function guessCalf(clip: string) {
  const nums = clip.split(/\D+/).filter(Boolean)
  return nums.find((n) => n.length >= 3 && n.length <= 5) ?? ''
}

type Pending = { clip: string; firstFrame: string; framesDir: string; videoPath: string }

export default function TimepointView({
  dir, project, timepoint, onOpenCapture, onVideoAdded, onDeleteCapture,
}: Props) {
  const caps = project.captures.filter((c) => c.timepointId === timepoint.id)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [calf, setCalf] = useState('')
  const [diet, setDiet] = useState('')
  const [quarter, setQuarter] = useState('')

  // one thumbnail per existing capture
  useEffect(() => {
    let alive = true
    Promise.all(
      caps
        .filter((c) => c.framePath)
        .map(async (c) =>
          [c.framePath!, await window.api.readImage(abs(dir, c.framePath)!)] as const),
    ).then((pairs) => alive && setThumbs(Object.fromEntries(pairs)))
    return () => {
      alive = false
    }
  }, [timepoint.id, project.captures])

  // add a clip -> split it -> jump straight into the split screen on the first still
  async function addVideo() {
    const files = await window.api.pickVideos()
    if (!files.length) return
    const video = files[0]
    let clip = safeName(video.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''))

    // re-importing the same clip would wipe the stills the existing capture points at
    if (caps.some((c) => c.clip === clip)) {
      if (!confirm(`"${clip}" is already in ${timepoint.name}. Import it again as a second copy?`))
        return
      let n = 2
      while (caps.some((c) => c.clip === `${clip}-${n}`)) n++
      clip = `${clip}-${n}`
    }

    setBusy('Copying clip and extracting stills…')
    try {
      // each clip gets its own folder under the timepoint: video + its stills together
      const outDir = `${dir}\\${safeName(timepoint.name)}\\${clip}`
      const res = await window.api.importVideo({ videoPath: video, outDir, fps: FPS })
      if (!res.frames.length) throw new Error('no stills were produced')
      // nothing is recorded until the operator confirms who this clip belongs to
      setPending({ clip, firstFrame: res.frames[0], framesDir: outDir, videoPath: res.videoPath })
      setCalf(guessCalf(clip))
      setDiet('')
      setQuarter(project.defaultQuarter ?? '')
    } catch (e) {
      alert('Import failed: ' + (e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <div className="head">
        <h2>
          {timepoint.name} <span className="muted small">{timepoint.date}</span>
        </h2>
        <button className="pri" onClick={addVideo} disabled={!!busy}>+ Add video…</button>
      </div>

      {busy && <p className="note">{busy}</p>}

      {caps.length === 0 && !busy && (
        <div className="empty">
          <p>No videos in this timepoint yet.</p>
          <p className="muted small">
            Add a clip — it is split into stills and opens straight into the measuring screen.
          </p>
          <button className="pri big" onClick={addVideo}>+ Add video…</button>
        </div>
      )}

      {caps.length > 0 && (
        <div className="capgrid">
          {caps.map((c) => {
            const m = metrics(c.border, scaleOf(project, c))
            return (
              <div key={c.id} className="cap" onClick={() => onOpenCapture(c)}>
                <button className="capx" title="Delete this video and its stills"
                  onClick={(e) => { e.stopPropagation(); onDeleteCapture(c.id) }}>✕</button>
                {c.framePath && thumbs[c.framePath] ? (
                  <img src={thumbs[c.framePath]} alt="" />
                ) : (
                  <div className="capblank" />
                )}
                <div className="capinfo">
                  <span className={'badge' + (m ? ' done' : '')}>{m ? 'measured' : 'to do'}</span>
                  <b>calf {c.calf}</b>{quarterOf(project, c) ? ` ${quarterOf(project, c)}` : ''}{' '}
                  <span className="muted">{c.diet}</span>
                  <br />
                  {c.clip}
                  <br />
                  {m
                    ? `${m.area.toFixed(2)} mm²  ·  w ${m.width.toFixed(2)}  ·  d ${m.depth.toFixed(2)}`
                    : 'click to measure'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pending && (
        <div className="modal">
          <div className="box">
            <h2>Which animal is this clip?</h2>
            <p className="muted small" style={{ marginTop: -8 }}>
              <b>{pending.clip}</b> — recorded against these details, not the filename.
            </p>
            <div className="field">
              <label>Calf id</label>
              <input value={calf} onChange={(e) => setCalf(e.target.value)}
                placeholder="e.g. 3112" autoFocus />
              <span className="muted small">
                {guessCalf(pending.clip)
                  ? 'suggested from the filename — check it is right'
                  : 'no id found in the filename — type it in'}
              </span>
            </div>
            <div className="field">
              <label>Diet</label>
              <select value={diet} onChange={(e) => setDiet(e.target.value)}>
                <option value="">—</option>
                {DIETS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Quarter</label>
              <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                <option value="">—</option>
                {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div className="row end">
              <button onClick={() => setPending(null)}>Cancel</button>
              <button className="pri" disabled={!calf.trim() || !diet}
                onClick={() => {
                  onVideoAdded(pending.clip, pending.firstFrame, pending.framesDir,
                    pending.videoPath, calf.trim(), diet, quarter)
                  setPending(null)
                }}>
                Add capture
              </button>
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Calf id and diet are required — without them the measurement cannot be
              grouped in the chart or the CSV.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
