import { useEffect, useState } from 'react'
import type { Capture, Project, Timepoint } from '../types'
import { metrics, quarterOf, scaleOf } from '../measure'
import { abs, safeName, timepointDir } from '../paths'
import { onImportProgress } from '../webapi/support'

const FPS = 5 // stills per second of video

/**
 * One imported file waiting for the operator to confirm whose gland it is.
 * Stills and clips share this: a clip additionally carries videoPath, and its
 * framePath is the first extracted still.
 */
export type ImportEntry = {
  clip: string
  framesDir: string
  framePath: string
  videoPath?: string
  calf: string
  diet: string
  quarter: string
}

type Props = {
  dir: string
  project: Project
  timepoint: Timepoint
  onOpenCapture: (c: Capture) => void
  onImported: (entries: ImportEntry[]) => void
  onDeleteCapture: (id: string) => void
}

const DIETS = ['HC', 'LC']
const QUARTERS = ['LF', 'RF', 'LR', 'RR']

/**
 * Suggest a calf id from the filename — only ever a suggestion the operator
 * confirms. An explicit "Calf 2" wins; otherwise take the first 3-5 digit run,
 * which skips an 8-digit date.
 */
function guessCalf(clip: string) {
  const named = clip.match(/calf[\s_-]*(\d{1,5})/i)
  if (named) return named[1]
  const nums = clip.split(/\D+/).filter(Boolean)
  return nums.find((n) => n.length >= 3 && n.length <= 5) ?? ''
}

/**
 * Lumify filenames number the gland ("Calf 2 Qtr 3") rather than naming it.
 * This is the conventional order and is shown in the import dialog for the
 * operator to correct — nothing is recorded until they confirm the row.
 */
const QUARTER_BY_NUMBER: Record<string, string> = { 1: 'LF', 2: 'RF', 3: 'LR', 4: 'RR' }

function guessQuarter(clip: string) {
  const m = clip.match(/q(?:tr|uarter)?[\s_-]*([1-4])\b/i)
  return m ? QUARTER_BY_NUMBER[m[1]] : ''
}

/** Fields the operator has not filled in yet, given a freshly imported file. */
const suggest = (clip: string, defaultQuarter?: string) => ({
  calf: guessCalf(clip),
  diet: '',
  quarter: guessQuarter(clip) || defaultQuarter || '',
})

export default function TimepointView({
  dir, project, timepoint, onOpenCapture, onImported, onDeleteCapture,
}: Props) {
  const caps = project.captures.filter((c) => c.timepointId === timepoint.id)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [rows, setRows] = useState<ImportEntry[] | null>(null)

  // One thumbnail per capture. Settled per file, not all-or-nothing: one image
  // missing from disk used to reject the batch and leave every tile blank.
  useEffect(() => {
    let alive = true
    Promise.all(
      caps
        .filter((c) => c.framePath)
        .map(async (c) => {
          try {
            return [c.framePath!, await window.api.readImage(abs(dir, c.framePath)!)] as const
          } catch {
            return null
          }
        }),
    ).then((pairs) => {
      if (alive) setThumbs(Object.fromEntries(pairs.filter((p) => p !== null)))
    })
    return () => {
      alive = false
    }
  }, [timepoint.id, project.captures])

  // the browser build reports how far a clip split has got; ffmpeg returns in one step
  useEffect(() => {
    onImportProgress((text) => setBusy(text))
    return () => onImportProgress(() => {})
  }, [])

  const tpDir = `${dir}\\${timepointDir(timepoint)}`

  /** Stills: copy them all in one go, then confirm every row at once. */
  async function addImages() {
    const files = await window.api.pickImages()
    if (!files.length) return
    setBusy(`Copying ${files.length} image${files.length > 1 ? 's' : ''}…`)
    try {
      const imported = await window.api.importImages({ files, baseDir: tpDir })
      setRows(imported.map((im) => ({
        clip: im.clip, framesDir: im.framesDir, framePath: im.imagePath,
        ...suggest(im.clip, project.defaultQuarter),
      })))
    } catch (e) {
      alert('Import failed: ' + (e as Error).message)
    } finally {
      setBusy('')
    }
  }

  /**
   * Clips, same batch flow. Each is split in turn — that is the slow part, so
   * the progress line names the clip being worked on. A clip that will not
   * decode is reported and skipped rather than losing the whole batch.
   */
  async function addVideos() {
    const files = await window.api.pickVideos()
    if (!files.length) return
    const taken = new Set(caps.map((c) => c.clip))
    const done: ImportEntry[] = []
    const failed: string[] = []

    for (const [i, video] of files.entries()) {
      const base = safeName(video.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''))
      let clip = base
      for (let n = 2; taken.has(clip); n++) clip = `${base}-${n}`
      taken.add(clip)

      setBusy(`Clip ${i + 1} of ${files.length} — extracting stills from ${clip}…`)
      try {
        const outDir = `${tpDir}\\${clip}`
        const res = await window.api.importVideo({ videoPath: video, outDir, fps: FPS })
        if (!res.frames.length) throw new Error('no stills were produced')
        done.push({
          clip, framesDir: outDir, framePath: res.frames[0], videoPath: res.videoPath,
          ...suggest(clip, project.defaultQuarter),
        })
      } catch (e) {
        failed.push(`${clip}: ${(e as Error).message}`)
      }
    }

    setBusy('')
    if (failed.length) alert(`Could not import:\n\n${failed.join('\n')}`)
    if (done.length) setRows(done)
  }

  function editRow(i: number, patch: Partial<ImportEntry>) {
    setRows((rs) => rs && rs.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }

  /** Backing out must not leave orphan copies behind in the project folder. */
  async function discardRows(dropped: ImportEntry[]) {
    for (const r of dropped) {
      try {
        await window.api.deleteFolder({
          projectDir: dir, target: `${timepointDir(timepoint)}\\${r.clip}`,
        })
      } catch { /* already gone */ }
    }
  }

  const rowsReady = !!rows?.length && rows.every((r) => r.calf.trim() && r.diet)

  /**
   * Same calf and same gland, twice in one timepoint — allowed (a repeat scan is
   * legitimate) but flagged, because it silently doubles that animal's weight in
   * the timepoint average. The sample set contains exactly this case.
   */
  function duplicateOf(r: ImportEntry, i: number) {
    const key = (calfId: string, q: string) => `${calfId.trim().toLowerCase()}|${q}`
    if (!r.calf.trim()) return ''
    const mine = key(r.calf, r.quarter)
    if (rows?.some((o, n) => n < i && key(o.calf, o.quarter) === mine)) return 'also above'
    if (caps.some((c) => key(c.calf, c.quarter ?? project.defaultQuarter ?? '') === mine))
      return 'already in this timepoint'
    return ''
  }

  const dupes = rows?.filter((r, i) => duplicateOf(r, i)).length ?? 0

  return (
    <>
      <div className="head">
        <h2>
          {timepoint.name} <span className="muted small">{timepoint.date}</span>
        </h2>
        <div className="row">
          <button onClick={addVideos} disabled={!!busy}>+ Add videos…</button>
          <button className="pri" onClick={addImages} disabled={!!busy}>+ Add images…</button>
        </div>
      </div>

      {busy && <p className="note">{busy}</p>}

      {caps.length === 0 && !busy && (
        <div className="empty">
          <p>Nothing in this timepoint yet.</p>
          <p className="muted small">
            Add images to measure them directly, or add clips — each is split into stills so you
            can pick the clearest frame. Select as many files at once as you like.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="big" onClick={addVideos}>+ Add videos…</button>
            <button className="pri big" onClick={addImages}>+ Add images…</button>
          </div>
        </div>
      )}

      {caps.length > 0 && (
        <div className="capgrid">
          {caps.map((c) => {
            const m = metrics(c.border, scaleOf(project, c))
            return (
              <div key={c.id} className="cap" onClick={() => onOpenCapture(c)}>
                <button className="capx" title="Delete this capture and its files"
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

      {rows && (
        <div className="modal">
          <div className="box wide">
            <h2>Which animal is each {rows.some((r) => r.videoPath) ? 'file' : 'image'}?</h2>
            <p className="muted small" style={{ marginTop: -8 }}>
              Calf id and quarter are read from the filename as a suggestion. Check every row —
              this is what gets recorded, not the filename.
            </p>

            <div className="row" style={{ marginBottom: 10 }}>
              <span className="muted small">Set every row&apos;s diet:</span>
              {DIETS.map((d) => (
                <button key={d} onClick={() => setRows((rs) => rs && rs.map((r) => ({ ...r, diet: d })))}>
                  {d}
                </button>
              ))}
            </div>

            <table className="rowtable">
              <thead>
                <tr><th>File</th><th>Calf id</th><th>Quarter</th><th>Diet</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.framesDir}>
                    <td className="fname" title={r.clip}>
                      {r.clip}
                      {duplicateOf(r, i) && (
                        <><br /><span className="overridden">same calf + quarter — {duplicateOf(r, i)}</span></>
                      )}
                    </td>
                    <td>
                      <input value={r.calf} onChange={(e) => editRow(i, { calf: e.target.value })}
                        style={{ width: 72 }} />
                    </td>
                    <td>
                      <select value={r.quarter} onChange={(e) => editRow(i, { quarter: e.target.value })}
                        style={{ width: 68 }}>
                        <option value="">—</option>
                        {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.diet} onChange={(e) => editRow(i, { diet: e.target.value })}
                        style={{ width: 68 }}>
                        <option value="">—</option>
                        {DIETS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className="tpedit del" title="Do not add this one"
                        onClick={() => {
                          discardRows([r])
                          setRows((rs) => rs && rs.filter((_, n) => n !== i))
                        }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="row end">
              <button onClick={() => { discardRows(rows); setRows(null) }}>Cancel</button>
              <button className="pri" disabled={!rowsReady}
                onClick={() => { onImported(rows); setRows(null) }}>
                Add {rows.length} capture{rows.length > 1 ? 's' : ''}
              </button>
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Every row needs a calf id and a diet — without them the measurement cannot be
              grouped in the chart or the CSV. Cancelling removes the copies again.
              {dupes > 0 && ` ${dupes} row${dupes > 1 ? 's are' : ' is'} a repeat of the same ` +
                `calf and gland; both will be averaged into this timepoint. Remove one with ✕ ` +
                `if that is not what you want.`}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
