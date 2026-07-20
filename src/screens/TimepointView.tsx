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
  ) => void
}

export default function TimepointView({
  dir, project, timepoint, onOpenCapture, onVideoAdded,
}: Props) {
  const caps = project.captures.filter((c) => c.timepointId === timepoint.id)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

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
      onVideoAdded(clip, res.frames[0], outDir, res.videoPath)
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
              <button key={c.id} className="cap" onClick={() => onOpenCapture(c)}>
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
                    ? `${m.area.toFixed(0)} mm²  ·  w ${m.width.toFixed(1)}  ·  d ${m.depth.toFixed(1)}`
                    : 'click to measure'}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
